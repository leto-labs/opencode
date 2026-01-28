# Phase 4: Voice Tool Calling

**Status: IN PROGRESS**

## PRD

Enable the voice assistant to execute OpenCode tools. When OpenAI generates a function call, the client forwards it to the server for execution, then sends the result back to OpenAI. The voice agent should also use OpenCode's system prompt for consistent behavior.

## Architecture

```
┌─────────────────┐      WebRTC (audio)       ┌─────────────────┐
│   Web Client    │◄─────────────────────────►│  OpenAI Realtime│
│                 │                            │       API       │
│  Configure      │   ◄── function_call ───    │                 │
│  tools + prompt │   ─── function_result ──►  │                 │
└────────┬────────┘                            └─────────────────┘
         │
         │ GET /session/:id/tools (list)
         │ GET /session/:id/system_prompt (instructions)
         │ POST /session/:id/tool/call (execute)
         ▼
┌─────────────────┐
│  OpenCode Server│
│  - Tool Registry│
│  - System Prompt│
│  - Execution    │
└─────────────────┘
```

---

## Current State Analysis

### session/tool.ts (Completed in this branch)

The `SessionTool` module handles tool execution for client-side inference:

```typescript
SessionTool.call({
  sessionID,
  toolName: "read",
  callId: "call_123",
  arguments: { filePath: "/path/to/file" }
})
// Returns: { callId, result, error? }
```

**What it does:**
1. Validates session exists
2. Looks up tool from `ToolRegistry.tools()`
3. Creates assistant message to hold the tool call
4. Creates `ToolPart` with "running" status
5. Builds `Tool.Context` with session messages (for context-aware tools)
6. Executes tool via `tool.execute(args, ctx)`
7. Updates `ToolPart` with result/error and timestamps
8. Returns result to caller

**Key difference from traditional flow:**
- Tool is executed on-demand (client sends request) vs in a loop (server decides)
- Message/part storage is handled here vs in the agent loop
- No permission UI yet (ctx.ask is a no-op)

---

## Comparison: Server-Side vs Client-Side Tool Flow

| Aspect | Server-Side (Traditional) | Client-Side (Realtime) |
|--------|---------------------------|------------------------|
| **Who decides** | Server (LLM in agent loop) | Client (from OpenAI) |
| **Who executes** | Server (immediate) | Server (via `/tool/call`) |
| **Result handling** | Append to context, continue loop | Return to client, relay to OpenAI |
| **Message creation** | In agent loop | In `SessionTool.call()` |
| **Permission UX** | SSE events, UI prompts | Not implemented yet |
| **System prompt** | Built from config + instructions | Hardcoded in client |
| **Tool registration** | Passed to `streamText()` | Passed to `RealtimeSession` config |

### Traditional Agent Loop (session/prompt.ts)

```
┌───────────────────────────────────────┐
│ Server                                │
│                                       │
│  1. Build system prompt               │
│     - SystemPrompt.provider(model)    │
│     - InstructionPrompt.system()      │
│     - Agent.prompt                    │
│                                       │
│  2. Register tools                    │
│     - ToolRegistry.tools(model)       │
│     - Filter by agent permissions     │
│                                       │
│  3. streamText({ tools, messages })   │
│                                       │
│  4. For each tool_call:               │
│     - Check permissions               │
│     - Execute tool                    │
│     - Store ToolPart                  │
│     - Continue loop                   │
└───────────────────────────────────────┘
```

### Client-Side Flow (Current)

```
┌─────────────────┐               ┌─────────────────┐
│ Client          │               │ Server          │
│                 │               │                 │
│ 1. Connect with │               │                 │
│    hardcoded:   │               │                 │
│    - "You are   │               │                 │
│      helpful"   │               │                 │
│    - No tools   │               │                 │
│                 │               │                 │
│ 2. Receive      │ tool/call     │                 │
│    function_call│──────────────►│ 3. Execute tool │
│                 │               │    Store result │
│                 │◄──────────────│                 │
│ 4. Send result  │               │                 │
│    to OpenAI    │               │                 │
└─────────────────┘               └─────────────────┘
```

---

## What's Missing

### 1. Tool Definitions Endpoint

Need `GET /session/:id/tools` to return tools in OpenAI function format:

```typescript
// OpenAI expects this format
{
  type: "function",
  name: "read",
  description: "Read file contents",
  parameters: {
    type: "object",
    properties: {
      filePath: { type: "string", description: "Path to file" }
    },
    required: ["filePath"]
  }
}
```

**Challenge**: Our tools use Zod schemas. Need to convert to JSON Schema:
- Use `zod-to-json-schema` or similar
- Strip internal metadata
- Handle complex types (discriminated unions, etc.)

### 2. System Prompt for Voice Agent

Currently the RealtimeAgent uses:
```typescript
const agent = new RealtimeAgent({
  instructions: "You are a helpful assistant. Keep responses concise."
})
```

Should use OpenCode's prompt infrastructure:
```typescript
// What server builds for traditional agents
const systemPrompt = [
  ...SystemPrompt.provider(model),     // Model-specific prompt
  ...await SystemPrompt.environment(model), // Environment info
  ...await InstructionPrompt.system(), // AGENTS.md, CLAUDE.md
  agent.prompt,                        // Agent-specific additions
].join("\n\n")
```

**Options:**
1. **New endpoint**: `GET /session/:id/system_prompt` returns assembled prompt
2. **Include in tools response**: Return `{ tools, instructions }` together
3. **Client-side assembly**: Client calls multiple endpoints and assembles

### 3. Frontend Tool Handler

In `useRealtimeConnection.ts`, need to:
```typescript
session.on("function_call_arguments.done", async (event) => {
  const { name, arguments: args, call_id } = event

  // Forward to server
  const result = await sdk.client.session.tool.call({
    sessionID,
    toolName: name,
    callId: call_id,
    arguments: JSON.parse(args),
  })

  // Send result back to OpenAI
  if (result.error) {
    session.sendFunctionCallOutput({
      callId: call_id,
      output: JSON.stringify({ error: result.error })
    })
  } else {
    session.sendFunctionCallOutput({
      callId: call_id,
      output: result.data?.result ?? ""
    })
  }
})
```

### 4. Tool Configuration on Connect

When creating the RealtimeSession:
```typescript
// Fetch tools from server
const toolsResponse = await sdk.client.session.tools({ sessionID })
const tools = toolsResponse.data

// Fetch system prompt
const promptResponse = await sdk.client.session.systemPrompt({ sessionID })
const instructions = promptResponse.data

// Create agent with proper config
const agent = new RealtimeAgent({
  name: "OpenCode",
  instructions,
  tools,  // OpenAI function format
})
```

---

## Implementation Plan

### Phase 4a: Tool Definitions

1. Create `session/tools.ts` module:
   ```typescript
   export namespace SessionTools {
     export const ListInput = z.object({
       sessionID: Identifier.schema("session"),
     })

     export const ListOutput = z.array(z.object({
       type: z.literal("function"),
       name: z.string(),
       description: z.string(),
       parameters: z.any(), // JSON Schema
     }))

     export async function list(input: ListInput): Promise<ListOutput>
   }
   ```

2. Add route: `GET /session/:sessionID/tools`

3. Convert Zod schemas to JSON Schema (research best approach)

### Phase 4b: System Prompt Endpoint

1. Create `session/system_prompt.ts` module:
   ```typescript
   export namespace SessionSystemPrompt {
     export async function get(sessionID: string): Promise<string>
   }
   ```

2. Add route: `GET /session/:sessionID/system_prompt`

3. Reuse logic from `session/prompt.ts` system prompt building

### Phase 4c: Frontend Integration

1. Fetch tools and prompt on connect
2. Configure RealtimeAgent with fetched config
3. Handle `function_call_arguments.done` events
4. Forward to `/tool/call` endpoint
5. Send result back via `sendFunctionCallOutput()`

### Phase 4d: UI Feedback

1. Show tool execution indicator during calls
2. Display tool results in conversation (already handled by ToolPart storage)
3. Consider voice feedback ("Reading file...", "Done")

---

## Tasks

### Server
- [x] `POST /session/:id/tool/call` endpoint (Phase 2, extracted to module)
- [x] Create `session/tool.ts` module with `SessionTool.list()` and `SessionTool.call()`
- [x] `GET /session/:id/tools` - List available tools in OpenAI function format
- [x] Zod to JSON Schema conversion using Zod 4 native `z.toJSONSchema()`
- [x] `GET /session/:id/system_prompt` - Get assembled instructions (inline in routes)
- [x] Filter tools for voice mode (exclude task, question, batch, etc.)

### Client
- [x] Fetch tools on connect via `sdk.client.session.tools.list()`
- [x] Fetch system prompt on connect via `sdk.client.session.systemPrompt.get()`
- [x] Configure RealtimeAgent with server-provided instructions
- [x] Create `toOpenAIAgentTools()` utility to convert server tools to executable SDK tools
- [x] Forward tool calls to server `/tool/call` endpoint
- [x] Handle tool results and errors
- [ ] Tool execution UI indicator
- [ ] Error handling and retry logic

---

## Open Questions

1. **Which tools to enable?** ✅ RESOLVED
   - Subset for voice: read, glob, grep, write, edit, bash, webfetch, websearch, codesearch
   - Excluded: task (sub-agents), question (UI), batch, invalid, plan_*, skill, todo_*, apply_patch, lsp
   - See `VOICE_MODE_TOOLS` in `session/tool.ts`

2. **Permission handling in voice mode?**
   - Currently `ctx.ask()` is a no-op
   - Options: Auto-allow (unsafe), voice confirmation, UI prompt
   - Need to decide on UX

3. **Tool timeout handling?**
   - OpenAI may timeout if tool takes too long
   - Need to handle partial results or cancellation
   - AbortSignal support in tools

4. **System prompt size?**
   - Full OpenCode prompt is large
   - May need condensed version for voice
   - Token limits for realtime API?

---

## Success Criteria

- [x] Tools fetched and configured on connect
- [x] System prompt loaded from server
- [x] Function calls received from OpenAI (logged)
- [x] Tool execution on server via `/tool/call`
- [x] Results sent back to OpenAI (via `tool()` execute callback)
- [ ] Conversation continues naturally after tool use
- [ ] Tool calls visible in session history (ToolPart)
- [ ] Works for read, glob, grep, bash (basic set)

---

## Security Considerations

1. **Tool authorization** - Validate which tools the session can access
2. **Argument validation** - Zod validation before execution
3. **Timeout handling** - Tool execution < 30s to avoid OpenAI timeout
4. **Audit logging** - Log all tool executions (already in SessionTool)
5. **Permission bypass** - Currently no permission checks in voice mode

---

## References

- [Tool Flow Documentation](../architecture/tool-flow.md)
- [Tool Integration for Realtime](./tool-integration.md)
- [OpenAI Realtime API](./openai-api.md)
