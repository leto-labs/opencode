# Phase 4: Tool Calling

## Goal

Enable the voice assistant to execute tools. When OpenAI generates a function call, the client forwards it to the OpenCode server for execution, then sends the result back to OpenAI.

## Architecture

```
┌─────────────────┐      WebRTC (audio)      ┌─────────────────┐
│   Web Client    │◄────────────────────────►│  OpenAI Realtime│
│                 │                           │       API       │
│  Handle         │   ◄── function_call ───   │                 │
│  function calls │   ─── function_result ──► │                 │
└────────┬────────┘                           └─────────────────┘
         │
         │ POST /realtime-v2/:sessionID/tool-call
         │ (Execute tool on server)
         │
         ▼
┌─────────────────┐
│  OpenCode Server│
│                 │
│  - Tool Registry│
│  - Execution    │
│  - Sandboxing   │
└─────────────────┘
```

## Server Implementation

### 1. Tool Execution Endpoint

```typescript
// src/realtime-v2/server/tools.ts

import { z } from "zod"
import { Tool } from "../../tool/tool"
import { Log } from "../../util/log"

const log = Log.create({ service: "realtime-v2.tools" })

export const ToolCallInput = z.object({
  call_id: z.string(),
  name: z.string(),
  arguments: z.string(), // JSON string
})

export const ToolCallOutput = z.object({
  call_id: z.string(),
  output: z.string(),
  error: z.string().optional(),
})

export async function executeToolCall(
  sessionID: string,
  input: z.infer<typeof ToolCallInput>,
): Promise<z.infer<typeof ToolCallOutput>> {
  const { call_id, name, arguments: argsJson } = input

  log.info("executing tool call", { sessionID, call_id, name })

  try {
    // Parse arguments
    const args = JSON.parse(argsJson)

    // Get tool from registry
    const tool = await Tool.get(name)
    if (!tool) {
      return {
        call_id,
        output: JSON.stringify({ error: `Unknown tool: ${name}` }),
        error: `Unknown tool: ${name}`,
      }
    }

    // Execute tool
    const result = await tool.execute(args, { sessionID })

    log.info("tool execution complete", { sessionID, call_id, name })

    return {
      call_id,
      output: typeof result === "string" ? result : JSON.stringify(result),
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    log.error("tool execution failed", { sessionID, call_id, name, error: errorMessage })

    return {
      call_id,
      output: JSON.stringify({ error: errorMessage }),
      error: errorMessage,
    }
  }
}
```

### 2. Add Route

```typescript
// Update src/realtime-v2/server/routes.ts

import { executeToolCall, ToolCallInput, ToolCallOutput } from "./tools"

// Add to RealtimeV2Routes:
.post(
  "/:sessionID/tool-call",
  validator("param", z.object({ sessionID: z.string() })),
  validator("json", ToolCallInput),
  async (c) => {
    const { sessionID } = c.req.valid("param")
    const input = c.req.valid("json")

    const result = await executeToolCall(sessionID, input)

    return c.json(result)
  },
)
```

### 3. Tool Definition Endpoint

Clients need to know what tools are available:

```typescript
// Add to routes.ts

const ToolDefinition = z.object({
  type: z.literal("function"),
  name: z.string(),
  description: z.string(),
  parameters: z.record(z.any()),
})

.get(
  "/:sessionID/tools",
  validator("param", z.object({ sessionID: z.string() })),
  async (c) => {
    const { sessionID } = c.req.valid("param")

    // Get available tools for this session
    const tools = await Tool.list(sessionID)

    const definitions = tools.map((tool) => ({
      type: "function" as const,
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }))

    return c.json({ tools: definitions })
  },
)
```

## Client Implementation

### 1. Tool Call Handler

```typescript
// Update useRealtimeV2.ts

interface UseRealtimeV2Options {
  // ... existing options ...
  enableTools?: boolean
  onToolCall?: (name: string, args: any) => void
  onToolResult?: (name: string, result: any) => void
}

// In connect():
if (options.enableTools) {
  // Fetch available tools from server
  const toolsRes = await fetch(`${options.serverUrl}/realtime-v2/${options.sessionID}/tools`)
  const { tools } = await toolsRes.json()

  // Configure session with tools
  await transport.updateSessionConfig({
    tools: tools,
  })

  // Handle function calls
  transport.on("function_call", async (call) => {
    console.log("[realtime] function call:", call.name, call.arguments)
    options.onToolCall?.(call.name, JSON.parse(call.arguments))

    try {
      // Execute on server
      const res = await fetch(
        `${options.serverUrl}/realtime-v2/${options.sessionID}/tool-call`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            call_id: call.callId,
            name: call.name,
            arguments: call.arguments,
          }),
        },
      )

      const result = await res.json()
      options.onToolResult?.(call.name, result.output)

      // Send result back to OpenAI
      transport.sendFunctionCallOutput(call, result.output)
    } catch (err) {
      const errorOutput = JSON.stringify({ error: String(err) })
      transport.sendFunctionCallOutput(call, errorOutput)
    }
  })
}
```

### 2. Tool Status UI

```typescript
// src/components/ToolCallIndicator.tsx

interface ToolCall {
  id: string
  name: string
  status: "pending" | "executing" | "complete" | "error"
  args?: any
  result?: any
}

export function ToolCallIndicator({ calls }: { calls: ToolCall[] }) {
  return (
    <div className="fixed bottom-4 right-4 space-y-2">
      {calls.map((call) => (
        <div
          key={call.id}
          className={`p-2 rounded shadow ${
            call.status === "executing"
              ? "bg-yellow-100"
              : call.status === "complete"
              ? "bg-green-100"
              : call.status === "error"
              ? "bg-red-100"
              : "bg-gray-100"
          }`}
        >
          <div className="font-mono text-sm">{call.name}</div>
          {call.status === "executing" && (
            <div className="text-xs text-gray-500">Executing...</div>
          )}
        </div>
      ))}
    </div>
  )
}
```

### 3. Complete Voice Component with Tools

```typescript
// src/components/RealtimeV2Full.tsx

import { useState } from "react"
import { useRealtimeV2 } from "../hooks/useRealtimeV2"
import { ToolCallIndicator } from "./ToolCallIndicator"

export function RealtimeV2Full({ sessionID, apiKey, serverUrl }: Props) {
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([])

  const realtime = useRealtimeV2({
    apiKey,
    sessionID,
    serverUrl,
    enableVoice: true,
    enablePersistence: true,
    enableTools: true,
    onToolCall: (name, args) => {
      setToolCalls((prev) => [
        ...prev,
        { id: Date.now().toString(), name, status: "executing", args },
      ])
    },
    onToolResult: (name, result) => {
      setToolCalls((prev) =>
        prev.map((call) =>
          call.name === name && call.status === "executing"
            ? { ...call, status: "complete", result }
            : call,
        ),
      )
      // Auto-remove after 3 seconds
      setTimeout(() => {
        setToolCalls((prev) => prev.filter((c) => c.status !== "complete"))
      }, 3000)
    },
  })

  return (
    <div className="relative h-full">
      {/* Main voice UI */}
      <div className="flex flex-col h-full">
        {/* ... status bar, transcript, etc ... */}
      </div>

      {/* Tool call overlay */}
      <ToolCallIndicator calls={toolCalls} />
    </div>
  )
}
```

## Tool Examples

### Read File Tool

```typescript
// Server-side tool definition
{
  type: "function",
  name: "read_file",
  description: "Read the contents of a file",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "The file path to read",
      },
    },
    required: ["path"],
  },
}
```

### Run Command Tool

```typescript
{
  type: "function",
  name: "run_command",
  description: "Execute a shell command",
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The command to execute",
      },
    },
    required: ["command"],
  },
}
```

## Security Considerations

1. **Tool Authorization**: Server should validate which tools the session can access
2. **Argument Validation**: Validate tool arguments before execution
3. **Sandboxing**: Execute tools in isolated environment
4. **Rate Limiting**: Prevent abuse of tool execution
5. **Audit Logging**: Log all tool executions

```typescript
// Example authorization check
async function executeToolCall(sessionID: string, input: ToolCallInput) {
  // Check if session is authorized for this tool
  const session = await Session.get(sessionID)
  const allowedTools = session?.metadata?.allowedTools ?? []

  if (!allowedTools.includes(input.name)) {
    return {
      call_id: input.call_id,
      output: JSON.stringify({ error: "Tool not authorized" }),
      error: "Tool not authorized",
    }
  }

  // ... proceed with execution
}
```

## Success Criteria

- [ ] Server exposes tool definitions
- [ ] Client configures tools in session
- [ ] Function calls are received from OpenAI
- [ ] Client forwards calls to server
- [ ] Server executes tools
- [ ] Results are sent back to OpenAI
- [ ] Conversation continues after tool use
- [ ] Tool calls appear in UI
- [ ] Errors are handled gracefully

## Future Enhancements

1. **Ephemeral Keys**: Generate short-lived API keys for clients
2. **Streaming Tool Output**: Stream long-running tool output
3. **Tool Approval**: Require user confirmation for dangerous tools
4. **Parallel Tools**: Handle multiple concurrent tool calls
5. **Tool Cancellation**: Cancel tools when user interrupts

## Notes

- Tool execution happens synchronously; OpenAI waits for the result
- Keep tool execution fast (< 30s) to avoid timeouts
- Consider caching tool results for repeated calls
- Log tool usage for debugging and auditing
