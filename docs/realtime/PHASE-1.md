# Phase 1: Basic WebRTC Text Integration

## Goal

Create a minimal proof-of-concept where the web client connects directly to OpenAI Realtime API using the `@openai/agents-realtime` SDK. For simplicity:
- Use client-side API key (insecure, development only)
- Text input only (send text, receive text transcripts)
- Ignore audio data entirely
- No server integration yet

## Architecture

```
┌─────────────────┐        WebSocket         ┌─────────────────┐
│   Web Client    │◄────────────────────────►│  OpenAI Realtime│
│                 │                           │       API       │
│  - API Key      │                           │                 │
│  - SDK Instance │                           │  - gpt-realtime │
│  - Text I/O     │                           │                 │
└─────────────────┘                           └─────────────────┘
```

## Implementation Steps

### 1. Install SDK in Web Package

The `@openai/agents-realtime` package is already a dependency in the main package.
For the web client, we need to ensure it's available:

```bash
cd packages/web
pnpm add @openai/agents-realtime
```

### 2. Create Client-Side Realtime Hook

```typescript
// packages/web/src/hooks/useRealtimeV2.ts

import { useState, useCallback, useRef } from "react"
import { OpenAIRealtimeWebSocket } from "@openai/agents-realtime"

interface UseRealtimeV2Options {
  apiKey: string
  model?: string
}

interface Message {
  role: "user" | "assistant"
  content: string
  timestamp: number
}

export function useRealtimeV2(options: UseRealtimeV2Options) {
  const { apiKey, model = "gpt-4o-realtime-preview" } = options

  const [status, setStatus] = useState<"disconnected" | "connecting" | "connected">("disconnected")
  const [messages, setMessages] = useState<Message[]>([])
  const [error, setError] = useState<Error | null>(null)

  const transportRef = useRef<OpenAIRealtimeWebSocket | null>(null)

  const connect = useCallback(async () => {
    if (transportRef.current) return

    setStatus("connecting")
    setError(null)

    try {
      const transport = new OpenAIRealtimeWebSocket({
        apiKey,
        model,
        useInsecureApiKey: true, // Required for client-side API key
      })

      // Listen for all events
      transport.on("*", (event) => {
        console.log("[realtime] event:", event.type, event)
      })

      // Handle connection state
      transport.on("connection_change", (state) => {
        console.log("[realtime] connection:", state)
        if (state === "connected") setStatus("connected")
        else if (state === "disconnected") setStatus("disconnected")
      })

      // Handle text transcript from assistant
      transport.on("response.output_text.done", (event) => {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: event.text,
            timestamp: Date.now(),
          },
        ])
      })

      // Handle audio transcript from assistant (fallback)
      transport.on("response.output_audio_transcript.done", (event) => {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: event.transcript,
            timestamp: Date.now(),
          },
        ])
      })

      // Handle errors
      transport.on("error", (err) => {
        console.error("[realtime] error:", err)
        setError(new Error(String(err.error)))
      })

      // Connect with text-only modalities
      await transport.connect({
        model,
        initialSessionConfig: {
          modalities: ["text"], // Text only, no audio
          instructions: "You are a helpful assistant.",
        },
      })

      transportRef.current = transport
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
      setStatus("disconnected")
    }
  }, [apiKey, model])

  const disconnect = useCallback(() => {
    if (transportRef.current) {
      transportRef.current.close()
      transportRef.current = null
      setStatus("disconnected")
    }
  }, [])

  const sendMessage = useCallback((text: string) => {
    if (!transportRef.current || status !== "connected") return

    // Add to local messages
    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        content: text,
        timestamp: Date.now(),
      },
    ])

    // Send to OpenAI
    transportRef.current.sendMessage(text, {})
  }, [status])

  return {
    status,
    messages,
    error,
    connect,
    disconnect,
    sendMessage,
  }
}
```

### 3. Create Test Component

```typescript
// packages/web/src/components/RealtimeV2Test.tsx

import { useState } from "react"
import { useRealtimeV2 } from "../hooks/useRealtimeV2"

export function RealtimeV2Test() {
  const [apiKey, setApiKey] = useState("")
  const [input, setInput] = useState("")

  const { status, messages, error, connect, disconnect, sendMessage } = useRealtimeV2({
    apiKey,
  })

  const handleSend = () => {
    if (input.trim()) {
      sendMessage(input)
      setInput("")
    }
  }

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <h1 className="text-xl font-bold mb-4">Realtime V2 Test</h1>

      {/* API Key Input */}
      <div className="mb-4">
        <input
          type="password"
          placeholder="OpenAI API Key"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          className="w-full p-2 border rounded"
          disabled={status !== "disconnected"}
        />
      </div>

      {/* Connection Controls */}
      <div className="mb-4 flex gap-2">
        <button
          onClick={connect}
          disabled={status !== "disconnected" || !apiKey}
          className="px-4 py-2 bg-blue-500 text-white rounded disabled:opacity-50"
        >
          Connect
        </button>
        <button
          onClick={disconnect}
          disabled={status === "disconnected"}
          className="px-4 py-2 bg-red-500 text-white rounded disabled:opacity-50"
        >
          Disconnect
        </button>
        <span className="self-center">Status: {status}</span>
      </div>

      {/* Error Display */}
      {error && (
        <div className="mb-4 p-2 bg-red-100 text-red-700 rounded">
          {error.message}
        </div>
      )}

      {/* Messages */}
      <div className="mb-4 h-64 overflow-y-auto border rounded p-2">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`mb-2 p-2 rounded ${
              msg.role === "user" ? "bg-blue-100 ml-8" : "bg-gray-100 mr-8"
            }`}
          >
            <div className="text-xs text-gray-500">{msg.role}</div>
            <div>{msg.content}</div>
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="Type a message..."
          className="flex-1 p-2 border rounded"
          disabled={status !== "connected"}
        />
        <button
          onClick={handleSend}
          disabled={status !== "connected" || !input.trim()}
          className="px-4 py-2 bg-green-500 text-white rounded disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  )
}
```

## Testing

1. Start the web dev server
2. Navigate to the test component
3. Enter your OpenAI API key
4. Click Connect
5. Type messages and verify responses

## Success Criteria

- [ ] Client connects directly to OpenAI Realtime API
- [ ] Can send text messages
- [ ] Receives text responses from the model
- [ ] Connection state is properly tracked
- [ ] Errors are handled gracefully

## Notes

- This phase uses client-side API key which is **insecure**
- Phase 4 will introduce ephemeral keys for production use
- We're ignoring audio entirely - that comes in Phase 3
- No server integration yet - that's Phase 2

## Next Steps

Once this works, proceed to Phase 2 to add transcript persistence to the OpenCode server.
