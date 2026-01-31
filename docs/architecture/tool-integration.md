# Tool Integration Guide

This guide analyzes how to execute OpenCode tools from external agents and whether OpenCode server is a suitable harness for decoupled tool calling.

## Table of Contents

- [Executive Summary](#executive-summary)
- [Current Integration Options](#current-integration-options)
- [Proposed: Stateless Tool Execution Endpoint](#proposed-stateless-tool-execution-endpoint)
- [Comparison: OpenCode Server vs Custom MCP Server](#comparison-opencode-server-vs-custom-mcp-server)
- [Safeguards Preserved in External Use](#safeguards-preserved-in-external-use)
- [Example: Minimal MCP Server Wrapper](#example-minimal-mcp-server-wrapper)
- [Recommendations](#recommendations)
- [Related Documentation](#related-documentation)

## Executive Summary

**Question**: Is OpenCode server a good harness for external agent tool calling?

**Answer**: **Partially**. OpenCode provides excellent tool implementations with robust error handling, but the current `/tool/call` endpoint has limitations for production external agent use:

| Aspect               | Status       | Notes                               |
| -------------------- | ------------ | ----------------------------------- |
| Tool implementations | ✅ Excellent | Well-tested, safe, feature-complete |
| Input validation     | ✅ Excellent | Zod schemas with helpful errors     |
| Output truncation    | ✅ Excellent | Prevents token explosion            |
| Error handling       | ✅ Excellent | Structured errors, recovery hints   |
| Permission system    | ⚠️ Bypassed  | `/tool/call` has no-op `ctx.ask`    |
| Session dependency   | ⚠️ Required  | Must create session first           |
| Stateless execution  | ❌ Missing   | No direct tool execution endpoint   |

**Recommendation**: For production external agent use, consider one of these approaches:

1. **Use OpenCode as-is** with session management (current state)
2. **Extend OpenCode** with a stateless `/tool/execute` endpoint
3. **Build a specialized MCP server** that wraps OpenCode tool implementations

---

## Current Integration Options

### Option 1: Use `/session/:id/tool/call` Endpoint

The existing endpoint designed for client-side inference.

**Pros:**

- Already implemented
- Full tool access
- Stores execution history in ToolParts
- Integrates with session context

**Cons:**

- Requires session creation first
- Permission system is bypassed (no user approval flow)
- Tied to OpenCode's session model
- No standalone tool introspection

**Example Usage:**

```typescript
// 1. Create a session
const sessionRes = await fetch("http://localhost:8787/session", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    title: "External Agent Session",
    providerID: "external",
    modelID: "external-agent",
  }),
})
const session = await sessionRes.json()

// 2. Execute a tool
const toolRes = await fetch(`http://localhost:8787/session/${session.id}/tool/call`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-opencode-directory": "/absolute/path/to/project",
  },
  body: JSON.stringify({
    toolName: "read",
    callId: "call-123",
    arguments: {
      filePath: "/path/to/file.ts",
    },
    // Required: model used for tool selection and task subagent inheritance
    model: { providerID: "openai", modelID: "gpt-4" },
    agent: "external",
  }),
})
const result = await toolRes.json()
// { callId: 'call-123', result: '...file contents...', error?: string }
```

### Option 2: Direct Tool Registry Access (Internal)

For agents running in the same process as OpenCode.

```typescript
// Inside the OpenCode codebase, use:
// - packages/opencode/src/tool/registry.ts
// - packages/opencode/src/tool/tool.ts
import { ToolRegistry } from "../../packages/opencode/src/tool/registry"
import { Tool } from "../../packages/opencode/src/tool/tool"

// Get all available tools
const tools = await ToolRegistry.tools(
  { providerID: "openai", modelID: "gpt-4" },
  agent, // optional agent context
)

// Execute a specific tool
const readTool = tools.find((t) => t.id === "read")
const result = await readTool.execute(
  { filePath: "/path/to/file.ts" },
  {
    sessionID: "session-123",
    messageID: "msg-123",
    agent: "external",
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {}, // No-op or implement permission handling
  },
)
```

### Option 3: Build an MCP Server Wrapper

Create an MCP server that exposes OpenCode tools via the Model Context Protocol.

**Architecture:**

```
External Agent
      │
      │ MCP Protocol
      ▼
┌──────────────────┐
│  MCP Server      │
│  (Your wrapper)  │
│                  │
│  - Permission    │
│    enforcement   │
│  - Rate limiting │
│  - Audit logging │
└────────┬─────────┘
         │
         │ Direct import
         ▼
┌──────────────────┐
│  OpenCode Tools  │
│  (Tool Registry) │
└──────────────────┘
```

**Pros:**

- Standard protocol (MCP) for tool discovery and execution
- Full control over permission enforcement
- Can add custom safeguards
- Works with any MCP-compatible agent

**Cons:**

- Requires building and maintaining wrapper
- Duplicates some OpenCode infrastructure

---

## Proposed: Stateless Tool Execution Endpoint

For better external agent support, OpenCode could expose a stateless endpoint:

### `POST /tool/execute`

**Request:**

```typescript
{
  tool: string                    // Tool ID
  arguments: Record<string, any>  // Tool parameters
  context?: {
    cwd?: string                  // Working directory
    permissions?: Ruleset         // Permission overrides
    timeout?: number              // Execution timeout
  }
}
```

**Response:**

```typescript
{
  success: boolean
  result?: {
    output: string
    title: string
    metadata: Record<string, any>
    attachments?: FilePart[]
  }
  error?: {
    code: string
    message: string
    details?: any
  }
}
```

### `GET /tool`

List available tools with their schemas.

**Response:**

```typescript
{
  tools: Array<{
    id: string
    description: string
    parameters: JSONSchema7
  }>
}
```

---

## Comparison: OpenCode Server vs Custom MCP Server

| Factor                   | OpenCode Server      | Custom MCP Server           |
| ------------------------ | -------------------- | --------------------------- |
| **Setup complexity**     | Low (already exists) | Medium (build from scratch) |
| **Tool implementations** | ✅ All included      | Must import or reimplement  |
| **Protocol**             | REST API             | MCP (standard)              |
| **Permission control**   | Limited              | Full control                |
| **Session management**   | Required             | Optional                    |
| **Agent compatibility**  | Custom integration   | Any MCP client              |
| **Maintenance**          | Minimal              | Your responsibility         |
| **Customization**        | Fork required        | Full flexibility            |

### When to Use OpenCode Server

- You're building a client that integrates with OpenCode
- You want session history and tool execution tracking
- You're prototyping or building internal tools
- You don't need fine-grained permission control per external agent

### When to Build a Custom MCP Server

- You need standardized tool discovery (MCP `tools/list`)
- You have multiple external agents with different permissions
- You need audit logging and rate limiting
- You want stateless tool execution
- You're building a production multi-tenant system

---

## Safeguards Preserved in External Use

### ✅ Always Applied

1. **Input validation** - Zod schema validation happens in `Tool.define()`
2. **Output truncation** - Large outputs truncated automatically
3. **Error handling** - Structured errors with recovery hints
4. **External directory checks** - File access outside workspace requires permission

### ⚠️ Partially Applied

1. **Doom loop detection** - Only in server-side inference loop
2. **Permission system** - Bypassed in `/tool/call` (ctx.ask is no-op)

### ❌ Not Applied

1. **User approval flow** - No UI for external agent permissions
2. **Session-based permission caching** - No persistence for external calls

---

## Example: Minimal MCP Server Wrapper

```typescript
// mcp-opencode-tools/index.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { ToolRegistry } from "@opencode/tool/registry"
import { Tool } from "@opencode/tool/tool"

const server = new Server(
  {
    name: "opencode-tools",
    version: "1.0.0",
  },
  {
    capabilities: { tools: {} },
  },
)

// List tools
server.setRequestHandler("tools/list", async () => {
  const tools = await ToolRegistry.tools({ providerID: "openai", modelID: "gpt-4" })
  return {
    tools: tools.map((t) => ({
      name: t.id,
      description: t.description,
      inputSchema: zodToJsonSchema(t.parameters),
    })),
  }
})

// Execute tool
server.setRequestHandler("tools/call", async (request) => {
  const { name, arguments: args } = request.params
  const tools = await ToolRegistry.tools({ providerID: "openai", modelID: "gpt-4" })
  const tool = tools.find((t) => t.id === name)

  if (!tool) {
    throw new Error(`Tool not found: ${name}`)
  }

  // Create minimal context
  const ctx: Tool.Context = {
    sessionID: "mcp-session",
    messageID: "mcp-call",
    agent: "mcp",
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async (req) => {
      // Implement your permission logic here
      // Could check against config, rate limits, etc.
    },
  }

  const result = await tool.execute(args, ctx)
  return {
    content: [{ type: "text", text: result.output }],
  }
})

// Run server
const transport = new StdioServerTransport()
await server.connect(transport)
```

---

## Recommendations

### For Prototyping / Internal Use

Use the existing `/session/:id/tool/call` endpoint:

1. Create a dedicated session for your external agent
2. Use the session ID for all tool calls
3. Accept that permissions are bypassed

### For Production External Agents

Build a custom MCP server wrapper that:

1. Imports OpenCode tool implementations directly
2. Implements proper permission enforcement
3. Adds audit logging and rate limiting
4. Provides stateless tool execution

### For Contributing to OpenCode

Consider adding:

1. A stateless `/tool/execute` endpoint
2. Tool introspection via `/tool` listing endpoint
3. Configurable permission modes (bypass, strict, custom)
4. Webhook support for permission requests

---

## Related Documentation

- [Tool Flow](./tool-flow.md) - How tool calling works internally
- [Tool Permissions](./tool-permissions.md) - Permission system deep-dive
- [Tool API Reference](./tool-api.md) - Detailed API documentation
- MCP code: [`packages/opencode/src/mcp/`](../../packages/opencode/src/mcp/)
