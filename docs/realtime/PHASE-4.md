# Phase 4: Voice Tool Calling

**Status: NOT STARTED**

## PRD

Enable the voice assistant to execute OpenCode tools. When OpenAI generates a function call, the client forwards it to the server for execution, then sends the result back to OpenAI.

## Architecture

```
┌─────────────────┐      WebRTC (audio)       ┌─────────────────┐
│   Web Client    │◄─────────────────────────►│  OpenAI Realtime│
│                 │                            │       API       │
│  Handle         │   ◄── function_call ───    │                 │
│  function calls │   ─── function_result ──►  │                 │
└────────┬────────┘                            └─────────────────┘
         │
         │ POST /session/:id/tool/call (existing)
         ▼
┌─────────────────┐
│  OpenCode Server│
│  - Tool Registry│
│  - Execution    │
└─────────────────┘
```

## Tasks

### Server (Existing infrastructure from Phase 2)
- [x] `POST /session/:id/tool/call` endpoint
- [ ] `GET /session/:id/tools` - List available tools for session
- [ ] Tool definition format for OpenAI Realtime

### Client
- [ ] Fetch tools on connect
- [ ] Configure tools in realtime session
- [ ] Handle `function_call` events from OpenAI
- [ ] Forward to server `/tool/call` endpoint
- [ ] Send result back via `sendFunctionCallOutput()`
- [ ] Tool execution UI indicator

## Implementation Plan

### 1. Tool Definitions Endpoint

Following the module pattern, create `session/tools.ts`:
```typescript
// packages/opencode/src/session/tools.ts
export namespace SessionTools {
  export async function list(sessionID: string) {
    // Get tools available for this session
    const tools = await Tool.list()
    return tools.map(t => ({
      type: "function",
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }))
  }
}
```

Route in `routes/session.ts`:
```typescript
GET /session/:sessionID/tools → SessionTools.list(sessionID)
```

### 2. Client Tool Handler
```typescript
// In useRealtimeConnection.ts or voice-mode.tsx
session.on("function_call", async (call) => {
  console.log("[voice] function call:", call.name)

  // Execute via existing endpoint (Phase 2)
  const result = await sdk.client.session.tool.call({
    sessionID,
    toolName: call.name,
    callId: call.callId,
    arguments: JSON.parse(call.arguments),
  })

  // Send result back to OpenAI
  if (result.error) {
    session.sendFunctionCallOutput(call, JSON.stringify({ error: result.error }))
  } else {
    session.sendFunctionCallOutput(call, result.data?.output ?? "")
  }
})
```

### 3. Tool Configuration on Connect
```typescript
// Fetch and configure tools when connecting
const { tools } = await sdk.client.session.tools({ sessionID })
await session.updateSessionConfig({ tools })
```

## Success Criteria

- [ ] Tools fetched and configured on connect
- [ ] Function calls received from OpenAI
- [ ] Tool execution on server
- [ ] Results sent back to OpenAI
- [ ] Conversation continues naturally after tool use
- [ ] Tool calls stored in session history

## Security Considerations

1. **Tool authorization** - Validate which tools the session can access
2. **Argument validation** - Validate before execution
3. **Timeout handling** - Tool execution < 30s to avoid OpenAI timeout
4. **Audit logging** - Log all tool executions
