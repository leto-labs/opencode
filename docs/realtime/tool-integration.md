# Tool Integration for Realtime

## Overview

Tools in realtime mode work similarly to text mode, with one key difference: **execution happens on the server** while the voice connection is direct to OpenAI.

```
┌─────────────────┐                      ┌─────────────────┐
│   Web Client    │ ←── function_call ── │  OpenAI Realtime│
│                 │                      │                 │
│  1. Receive     │                      │                 │
│     call        │                      │                 │
└────────┬────────┘                      └─────────────────┘
         │
         │ 2. POST /session/:id/tool/call
         ▼
┌─────────────────┐
│  OpenCode Server│
│                 │
│  3. Execute     │
│     tool        │
│                 │
│  4. Return      │
│     result      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐                      ┌─────────────────┐
│   Web Client    │ ── function_output ─→│  OpenAI Realtime│
│                 │                      │                 │
│  5. Forward     │                      │  6. Continue    │
│     result      │                      │     response    │
└─────────────────┘                      └─────────────────┘
```

## When Are Tools Called?

OpenAI Realtime uses **VAD** (Voice Activity Detection) to determine turn boundaries:

1. **User speaks** → Audio streamed to OpenAI
2. **User pauses** → VAD detects silence or sentence end
3. **Model responds** → May include tool calls
4. **Tool results fed back** → Model continues with tool output

**Important**: Tools are called **after** the user stops speaking, not during.

### Conversation Timeline

```
User speaking:     |████████████████|
VAD detection:                      |░░░|
Model thinking:                          |▒▒|
Tool call:                               |████|  (read_file)
Tool execution:                              |████████|
Model continues:                                        |████████████|
Audio output:                                |▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓|
```

## Client-Side Handling

```typescript
// In voice-mode.tsx or useRealtimeConnection hook
session.on("function_call", async (call) => {
  console.log("Tool call:", call.name, call.arguments)

  // Forward to server via SDK
  const result = await sdk.client.session.tool.call({
    sessionID,
    toolName: call.name,
    callId: call.callId,
    arguments: JSON.parse(call.arguments),
  })

  // Send result back to OpenAI
  session.sendFunctionCallOutput(call, result.data?.output ?? "")
})
```

## Server-Side Execution

```typescript
// POST /session/:sessionID/tool/call
async function handleToolCall(sessionID: string, input: ToolCallInput) {
  const { call_id, name, arguments: argsJson } = input

  try {
    const args = JSON.parse(argsJson)

    // Get tool from registry
    const tool = await Tool.get(name)
    if (!tool) {
      return {
        call_id,
        output: JSON.stringify({ error: `Unknown tool: ${name}` }),
      }
    }

    // Execute tool
    const result = await tool.execute(args, { sessionID })

    return {
      call_id,
      output: typeof result === "string" ? result : JSON.stringify(result),
    }
  } catch (err) {
    return {
      call_id,
      output: JSON.stringify({ error: err.message }),
    }
  }
}
```

## Tool Definition Format

Tools are defined in OpenAI's function format:

```typescript
{
  type: "function",
  name: "read_file",
  description: "Read the contents of a file",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "The file path to read"
      }
    },
    required: ["path"]
  }
}
```

The server will provide available tools via `GET /session/:sessionID/tools` (Phase 4).

## Interruption Handling

When the user speaks while a tool is executing:

```
Tool running:         |████████████████|
User speaks:                |████████████|  ← INTERRUPTION
```

1. VAD detects speech → `speech_started` event
2. Client receives event
3. Client cancels pending tool HTTP request (AbortController)
4. Tool execution may be aborted server-side
5. New user turn begins

### AbortSignal Support

Tools should support cancellation:

```typescript
async function executeWithAbort(args: Args, signal: AbortSignal) {
  // Check periodically
  if (signal.aborted) {
    return { interrupted: true, reason: "user_speech" }
  }

  // Long operation...
  const result = await someOperation()

  if (signal.aborted) {
    return { interrupted: true, partial: result }
  }

  return result
}
```

### Interrupted Tool State

```typescript
type ToolStatus = "pending" | "running" | "completed" | "error" | "interrupted"

interface InterruptedState {
  status: "interrupted"
  input: Record<string, any>
  reason: "user_speech" | "response_cancel" | "connection_lost"
  partialOutput?: string
}
```

## Permission Handling

Permissions work the same as text mode:

```typescript
// Tool requests permission
await ctx.ask({
  permission: "bash",
  patterns: ["rm -rf /tmp/*"],
  description: "Delete temporary files",
})
```

In realtime mode:

1. Tool execution pauses at permission request
2. Server sends permission request to client via HTTP response
3. Client shows permission dialog
4. User grants/denies
5. Tool execution continues or fails

**Note**: Voice-based permission granting requires careful UX design. Initial implementation uses UI buttons.

## Best Practices

1. **Keep tools fast**: Long-running tools block the conversation
2. **Support AbortSignal**: Tools should check for cancellation
3. **Provide progress updates**: For long operations, stream status
4. **Handle partial results**: If interrupted, save what was completed
5. **Limit tool complexity**: Voice users expect quick responses

## Example Tools

### Read File

```typescript
{
  type: "function",
  name: "read_file",
  description: "Read the contents of a file",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path" }
    },
    required: ["path"]
  }
}
```

### Run Command

```typescript
{
  type: "function",
  name: "run_command",
  description: "Execute a shell command",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "Command to run" }
    },
    required: ["command"]
  }
}
```

### Search Files

```typescript
{
  type: "function",
  name: "search_files",
  description: "Search for files matching a pattern",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Glob pattern" },
      path: { type: "string", description: "Directory to search" }
    },
    required: ["pattern"]
  }
}
```

## Security Considerations

1. **Tool Authorization**: Validate which tools the session can access
2. **Argument Validation**: Validate tool arguments before execution
3. **Sandboxing**: Execute tools in isolated environment
4. **Rate Limiting**: Prevent abuse of tool execution
5. **Audit Logging**: Log all tool executions
