# OpenCode Tool Flow

This document describes how tool calling works in OpenCode for both server-side and client-side inference modes.

## Overview

Tools enable LLMs to interact with the local environment (file system, shell, LSP, etc.). The key difference between inference modes is **who decides** to call a tool vs **who executes** it:

| Mode | Tool Decision | Tool Execution | Result Handling |
|------|---------------|----------------|-----------------|
| **Server-side** | Server (in agent loop) | Server | Server continues loop |
| **Client-side** | Client (from provider) | Server (relayed) | Client returns to provider |

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
      │  { toolName, callId, args }   │                                   │
      │──────────────────────────────►│                                   │
      │                               │  Find tool by name                │
      │                               │  Execute tool                     │
      │                               │  Store ToolPart (optional)        │
      │◄──────────────────────────────│                                   │
      │  { callId, result, error? }   │                                   │
      │                               │                                   │
      │  session.sendToolResult()     │                                   │
      │───────────────────────────────────────────────────────────────────►│
      │                               │                                   │
      │                               │                           Continues
      │                               │                           response
```

### Endpoint: `POST /session/:id/tool/call`

```typescript
// Request
{
  toolName: string,      // e.g., "read", "bash", "write"
  callId: string,        // From provider, for correlation
  arguments: {           // Tool-specific arguments
    filePath?: string,
    command?: string,
    // ...
  }
}

// Response
{
  callId: string,        // Echo back for correlation
  result: any,           // Tool output
  error?: string         // If execution failed
}
```

### Why a Separate Endpoint?

The existing `/command` endpoint won't work because:
- It's for predefined slash commands (`/commit`, `/review`)
- It expands templates and runs full prompt flow
- Not suitable for arbitrary tool execution

The `/tool/call` endpoint:
- Executes any registered tool by name
- Returns result directly (no inference loop)
- Client handles returning result to provider

---

## Tool Part Storage

Both modes store tool executions as `ToolPart`:

```typescript
interface ToolPart {
  id: string
  messageID: string
  sessionID: string
  type: "tool"
  tool: string           // Tool name
  callID: string         // Provider's call ID
  state: {
    status: "pending" | "running" | "completed" | "error"
    input: any           // Arguments
    output?: string      // Result
    error?: string       // If failed
    title?: string       // Human-readable summary
    metadata?: any       // Tool-specific data
  }
}
```

---

## Permission System

Tools require permissions before execution. Both modes use the same permission system:

```typescript
// Check if tool is allowed
const allowed = await Permission.check(sessionID, toolName, args)

if (!allowed) {
  // Server-side: pauses loop, waits for user approval
  // Client-side: returns error, client handles UX
}
```

See `permission/index.ts` for the full permission system.

---

## Available Tools

| Tool | Description | Key Arguments |
|------|-------------|---------------|
| `read` | Read file contents | `filePath`, `offset?`, `limit?` |
| `write` | Write/create file | `filePath`, `content` |
| `edit` | Edit file (search/replace) | `filePath`, `old`, `new` |
| `bash` | Execute shell command | `command`, `timeout?` |
| `glob` | Find files by pattern | `pattern`, `path?` |
| `grep` | Search file contents | `pattern`, `path?` |
| `lsp_*` | Language server operations | Varies |
| `mcp_*` | MCP server tools | Varies |

---

## Comparison

| Aspect | Server-Side | Client-Side |
|--------|-------------|-------------|
| Tool decision | LLM via server | LLM via client |
| Tool execution | Immediate in loop | Relayed via `/tool/call` |
| Result handling | Appended to context, loop continues | Returned to client, sent to provider |
| Permission UX | Server pauses, sends SSE | Client handles (TBD) |
| Storage | ToolPart in assistant message | ToolPart (optional, for history) |

---

## Related Files

| File | Purpose |
|------|---------|
| `server/routes/session.ts` | `/tool/call` endpoint |
| `session/prompt.ts` | Server-side tool execution in loop |
| `tool/*.ts` | Individual tool implementations |
| `permission/index.ts` | Permission checking |
| `app/src/context/voice-mode.tsx` | Client-side tool relay (TBD) |
