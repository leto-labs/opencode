# OpenCode Tool Flow

This document describes how tool calling works in OpenCode for both server-side and client-side inference modes, the available default tools, and how to integrate external agents.

## Overview

Tools enable LLMs to interact with the local environment (file system, shell, LSP, etc.). The key difference between inference modes is **who decides** to call a tool vs **who executes** it:

| Mode            | Tool Decision          | Tool Execution   | Result Handling            |
| --------------- | ---------------------- | ---------------- | -------------------------- |
| **Server-side** | Server (in agent loop) | Server           | Server continues loop      |
| **Client-side** | Client (from provider) | Server (relayed) | Client returns to provider |

## Table of Contents

- [Default Tools](#default-tools)
- [Tool Interface](#tool-interface)
- [Server-Side Tool Flow (Traditional)](#server-side-tool-flow-traditional)
- [Client-Side Tool Flow (Realtime)](#client-side-tool-flow-realtime)
- [Tool Part Storage](#tool-part-storage)
- [Permission System](#permission-system)
- [Safeguards and Error Handling](#safeguards-and-error-handling)
- [Comparison](#comparison)
- [Related Files](#related-files)
- [See Also](#see-also)

---

## Default Tools

OpenCode provides a set of built-in tools registered in [`packages/opencode/src/tool/registry.ts`](../../packages/opencode/src/tool/registry.ts):

### Core Tools

| Tool          | Description                | Key Parameters                         |
| ------------- | -------------------------- | -------------------------------------- |
| `read`        | Read file contents         | `filePath`, `offset?`, `limit?`        |
| `write`       | Create/overwrite files     | `filePath`, `content`                  |
| `edit`        | Edit file (search/replace) | `filePath`, `oldString`, `newString`, `replaceAll?` |
| `bash`        | Execute shell commands     | `command`, `workdir?`, `timeout?`, `description`     |
| `glob`        | Find files by pattern      | `pattern`, `path?`                     |
| `grep`        | Search file contents       | `pattern`, `path?`, `include?`         |
| `webfetch`    | Fetch web content          | `url`, `format?`, `timeout?`           |
| `websearch`   | Web search (EXA via MCP)   | `query`, `numResults?`, `type?`, `livecrawl?` |
| `codesearch`  | Code search                | `query`                                |
| `apply_patch` | Apply patch text           | `patchText` (used for GPT models)      |

### Extended Tools

| Tool                     | Description                  | Availability               |
| ------------------------ | ---------------------------- | -------------------------- |
| `question`               | Interactive user questions   | CLI/app/desktop only       |
| `task`                   | Create/manage subtasks       | Always                     |
| `todoread`               | Read todo list               | Always                     |
| `todowrite`              | Write todo list              | Always                     |
| `skill`                  | Load skill workflows         | Always                     |
| `batch`                  | Execute multiple operations  | Experimental (config flag) |
| `lsp`                    | Language server interactions | Experimental (flag)        |
| `plan_enter`/`plan_exit` | Plan mode tools              | Experimental (CLI only)    |

### MCP Tools

MCP (Model Context Protocol) tools are loaded from configured MCP servers and prefixed with the server name:

- Format: `{serverName}_{toolName}` (e.g., `github_search_code`)
- Configured in `.opencode/config.json` or global config

---

## Tool Interface

Every tool implements the `Tool.Info` interface from `packages/opencode/src/tool/tool.ts`:

```typescript
interface Tool.Info<Parameters, Metadata> {
  id: string
  init: (ctx?: InitContext) => Promise<{
    description: string
    parameters: Parameters        // Zod schema
    execute(args, ctx): Promise<{
      title: string               // Human-readable summary
      metadata: Metadata          // Tool-specific data
      output: string              // Result text
      attachments?: FilePart[]    // Optional file attachments
    }>
    formatValidationError?(error: z.ZodError): string
  }>
}
```

### Tool Context

Tools receive a context object with:

```typescript
interface Tool.Context {
  sessionID: string              // Current session
  messageID: string              // Parent message
  agent: string                  // Agent name
  abort: AbortSignal             // For cancellation
  callID?: string                // Provider's call ID
  extra?: Record<string, any>    // Extra context
  metadata(input): void          // Update tool part metadata
  ask(request): Promise<void>    // Request permission
}
```

---

## Server-Side Tool Flow (Traditional)

In server-side inference, the agent loop handles everything:

```
                    Server
                      │
    ┌─────────────────┼─────────────────┐
    │                 │                 │
    │    ┌────────────▼────────────┐    │
    │    │    LLM Provider Call    │    │
    │    │    (streamText)         │    │
    │    └────────────┬────────────┘    │
    │                 │                 │
    │    ┌────────────▼────────────┐    │
    │    │  Response with          │    │
    │    │  tool_calls: [          │    │
    │    │    { name, arguments }  │    │
    │    │  ]                      │    │
    │    └────────────┬────────────┘    │
    │                 │                 │
    │    ┌────────────▼────────────┐    │
    │    │  Execute Tool Locally   │    │
    │    │  ├─ Read file           │    │
    │    │  ├─ Write file          │    │
    │    │  ├─ Run bash            │    │
    │    │  └─ etc.                │    │
    │    └────────────┬────────────┘    │
    │                 │                 │
    │    ┌────────────▼────────────┐    │
    │    │  Store ToolPart         │    │
    │    │  { callID, state,       │    │
    │    │    input, output }      │    │
    │    └────────────┬────────────┘    │
    │                 │                 │
    │                 ▼                 │
    │         Continue Loop            │
    │    (until finish != tool-calls)  │
    │                                   │
    └───────────────────────────────────┘
```

### Key Code Paths

**1. Tool Registration (`session/prompt.ts:495-520`)**

```typescript
const tools = Object.fromEntries(
  resolved.tools
    .filter((t) => !disabled.has(t.name))
    .map((t) => [t.name, CoreTool<...>])
)
```

**2. LLM Call with Tools (`session/prompt.ts:547-600`)**

```typescript
const stream = streamText({
  model: ...,
  messages: msgs,
  tools,  // Tools available to the model
  ...
})
```

**3. Tool Execution (`session/prompt.ts:650-750`)**

```typescript
for await (const item of stream.fullStream) {
  if (item.type === "tool-call") {
    // Find tool, check permissions, execute
    const result = await tool.execute(item.args, ctx)
    // Store ToolPart with result
  }
}
```

**4. Loop Continuation (`session/prompt.ts:258-290`)**

```typescript
// Exit if assistant finished (not tool-calls)
if (lastAssistant?.finish && !["tool-calls", "unknown"].includes(lastAssistant.finish)) {
  break
}
// Otherwise, continue loop with tool results in context
```

---

## Client-Side Tool Flow (Realtime)

For client-side inference (e.g., GPT Realtime via WebRTC), the client receives tool calls from the provider and must relay them to the server for execution:

```
Client (Browser)                    Server                         OpenAI Realtime
      │                               │                                   │
      │◄──────────────────────────────────────────────────────────────────│
      │  function_call_arguments.done │                                   │
      │  { name: "read", arguments }  │                                   │
      │                               │                                   │
      │  POST /session/:id/tool/call  │                                   │
      │  { toolName, callId, arguments, model, agent? }                   │
      │──────────────────────────────►│                                   │
      │                               │  Find tool by name                │
      │                               │  Execute tool                     │
      │                               │  Store ToolPart                   │
      │◄──────────────────────────────│                                   │
      │  { callId, result, error? }   │                                   │
      │                               │                                   │
      │  session.sendToolResult()     │                                   │
      │───────────────────────────────────────────────────────────────────►│
      │                               │                           Continues
      │                               │                           response
```

### Endpoint: `POST /session/:id/tool/call`

**Request Schema:**

```typescript
{
  toolName: string      // Tool ID (e.g., "read", "bash", "write")
  callId: string        // From provider, for correlation
  arguments: {          // Tool-specific arguments
    filePath?: string
    command?: string
    // ...
  }
  model: { providerID: string; modelID: string } // Used for tool selection + task subagent inheritance
  agent?: string                                 // Tool context labeling
}
```

**Response Schema:**

```typescript
{
  callId: string        // Echo back for correlation
  result: any           // Tool output (string)
  error?: string        // If execution failed
}
```

### Implementation Details

Implementation lives in `SessionTool`:

- [`packages/opencode/src/session/tool.ts`](../../packages/opencode/src/session/tool.ts) (`SessionTool.list()`, `SessionTool.call()`)
- Route wiring: [`packages/opencode/src/server/routes/session.ts`](../../packages/opencode/src/server/routes/session.ts)

1. **Session validation**: Verifies session exists
2. **Tool lookup**: Finds tool from `ToolRegistry.tools()`
3. **Message creation**: Creates assistant message to hold tool call
4. **ToolPart creation**: Creates part with "running" status
5. **Tool execution**: Calls `tool.execute(args, ctx)`
6. **Result storage**: Updates ToolPart with result/error
7. **Response**: Returns `{ callId, result, error? }`

---

## Tool Part Storage

Both modes store tool executions as `ToolPart`:

```typescript
interface ToolPart {
  id: string
  messageID: string
  sessionID: string
  type: "tool"
  tool: string // Tool name
  callID: string // Provider's call ID
  state: {
    status: "pending" | "running" | "completed" | "error"
    input: any // Arguments
    output?: string // Result
    error?: string // If failed
    title?: string // Human-readable summary
    metadata?: any // Tool-specific data
    time?: {
      start: number
      end?: number
    }
  }
}
```

---

## Permission System

Tools require permissions before execution. The permission system is defined in `permission/next.ts`.

### Three-Level Permission Model

1. **Default permissions** (Agent-level)
   - Deny "question", "plan_enter", "plan_exit" by default
   - Allow everything else
   - Deny .env file reads

2. **User permissions** (from config)
   - Can override defaults per permission type
   - Pattern-based matching with wildcards

3. **Agent permissions** (role-based)
   - "build" - Question and plan tools allowed
   - "explore" - Only read/grep/glob/bash/web tools
   - "general" - All except todo tools

### Permission Flow

```typescript
// Inside tool execution
await ctx.ask({
  permission: "read", // Permission type
  patterns: [filepath], // What's being accessed
  always: ["*"], // Auto-allow patterns
  metadata: {}, // Context info
})
```

If permission is not granted:

- **Server-side**: Pauses loop, publishes `permission.asked` event, waits for user approval
- **Client-side**: Currently bypassed (ctx.ask is no-op in /tool/call endpoint)

### Permission Actions

| Action  | Behavior                            |
| ------- | ----------------------------------- |
| `allow` | Proceed immediately                 |
| `deny`  | Throw `DeniedError`, halt execution |
| `ask`   | Wait for user approval              |

### Permission Rules in Config

```json
{
  "permission": {
    "bash": "ask",
    "read": {
      "*": "allow",
      "~/.ssh/*": "deny"
    },
    "edit": "ask"
  }
}
```

---

## Safeguards and Error Handling

### Input Validation

`Tool.define()` wraps execute with Zod schema validation:

```typescript
toolInfo.execute = async (args, ctx) => {
  try {
    toolInfo.parameters.parse(args)
  } catch (error) {
    if (error instanceof z.ZodError && toolInfo.formatValidationError) {
      throw new Error(toolInfo.formatValidationError(error), { cause: error })
    }
    throw new Error(`The ${id} tool was called with invalid arguments: ${error}.`)
  }
  // ... execute
}
```

### Output Truncation

Large outputs are automatically truncated (`tool/truncation.ts`):

- **Max lines**: 2000 (default)
- **Max bytes**: 50KB
- **Behavior**:
  - Truncated content saved to disk
  - Agent directed to use grep/read with offset
  - Task tool can delegate to explore agent

### Doom Loop Detection

`SessionProcessor` detects repeated identical tool calls:

```typescript
// If same tool called 3x with identical inputs
if (doomLoopCount >= 3) {
  // Triggers "doom_loop" permission check
  // Prevents infinite tool call loops
}
```

### External Directory Protection

`assertExternalDirectory()` checks file access:

- Resolves symlinks and relative paths
- Requires permission for paths outside workspace
- Prevents accidental access to system files

---

## Comparison

| Aspect          | Server-Side                         | Client-Side                          |
| --------------- | ----------------------------------- | ------------------------------------ |
| Tool decision   | LLM via server                      | LLM via client                       |
| Tool execution  | Immediate in loop                   | Relayed via `/tool/call`             |
| Result handling | Appended to context, loop continues | Returned to client, sent to provider |
| Permission UX   | Server pauses, sends SSE            | Currently bypassed                   |
| Storage         | ToolPart in assistant message       | ToolPart created per call            |

---

## Related Files

| File                       | Purpose                                |
| -------------------------- | -------------------------------------- |
| `server/routes/session.ts` | `/tool/call` endpoint (lines 989-1137) |
| `session/prompt.ts`        | Server-side tool execution in loop     |
| `tool/tool.ts`             | Tool interface definition              |
| `tool/registry.ts`         | Tool registration and discovery        |
| `tool/*.ts`                | Individual tool implementations        |
| `permission/next.ts`       | Permission system                      |
| `mcp/index.ts`             | MCP tool integration                   |

---

## See Also

- [Tool Permissions](./tool-permissions.md) - Permission system deep-dive
- [Tool API Reference](./tool-api.md) - Detailed API documentation for external agents
- [Tool Integration Guide](./tool-integration.md) - How to execute tools from external agents
