# OpenAI Realtime API Reference

This document summarizes the OpenAI Realtime API as used in opencode.

## Connection

**Endpoint**: `wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview`

**With SDK**:

```typescript
import { OpenAIRealtimeWebSocket } from "@openai/agents-realtime"

const transport = new OpenAIRealtimeWebSocket({
  apiKey: "sk-..." or "ek-...",
  model: "gpt-4o-realtime-preview",
  useInsecureApiKey: true, // Required for non-ephemeral keys
})

await transport.connect({
  initialSessionConfig: { ... }
})
```

## Audio Format

| Direction | Format | Sample Rate | Channels | Encoding |
| --------- | ------ | ----------- | -------- | -------- |
| Input     | PCM16  | 24kHz       | Mono     | base64   |
| Output    | PCM16  | 24kHz       | Mono     | base64   |

Also supported: G.711 (µ-law and A-law) for telephony.

## Session Configuration

Sent via `session.update` after connection:

```typescript
// GA format (new)
{
  type: "realtime",
  output_modalities: ["text", "audio"],
  audio: {
    input: {
      format: { type: "audio/pcm", rate: 24000 },
      transcription: { model: "gpt-4o-mini-transcribe" },
      turn_detection: { type: "semantic_vad", eagerness: "medium" }
    },
    output: {
      format: { type: "audio/pcm", rate: 24000 },
      voice: "alloy",
      speed: 1.0
    }
  },
  instructions: "You are a helpful assistant.",
  tools: [...],
  temperature: 0.8
}
```

### Voice Options

| Voice     | Description          |
| --------- | -------------------- |
| `alloy`   | Neutral, balanced    |
| `echo`    | Warm, conversational |
| `shimmer` | Clear, expressive    |
| `ash`     | Soft, calm           |
| `ballad`  | Gentle, melodic      |
| `coral`   | Bright, friendly     |
| `sage`    | Wise, measured       |
| `verse`   | Dynamic, engaging    |

### Turn Detection

**Semantic VAD** (recommended):

```json
{
  "type": "semantic_vad",
  "eagerness": "medium"
}
```

- Uses classifier to detect natural utterance boundaries
- `eagerness`: "low", "medium", "high" - how quickly to respond

**Server VAD** (threshold-based):

```json
{
  "type": "server_vad",
  "threshold": 0.5,
  "prefix_padding_ms": 300,
  "silence_duration_ms": 500,
  "create_response": true,
  "interrupt_response": true
}
```

**Manual** (push-to-talk):

```json
{
  "type": "none"
}
```

## SDK Events

The `@openai/agents-realtime` SDK provides typed events:

### Connection Events

```typescript
transport.on("connection_change", (status) => {
  // "connecting" | "connected" | "disconnected"
})

transport.on("connected", () => { ... })
transport.on("disconnected", () => { ... })
transport.on("error", (error) => { ... })
```

### Audio Events

```typescript
// Receive audio from assistant
transport.on("audio", (event) => {
  // event.data: ArrayBuffer (PCM16)
  // event.responseId: string
})

transport.on("audio_done", () => {
  // Audio stream complete
})

transport.on("audio_interrupted", () => {
  // User interrupted, stop playback
})
```

### Transcript Events

```typescript
transport.on("audio_transcript_delta", (event) => {
  // event.delta: string (partial transcript)
  // event.itemId: string
})

// All events via wildcard
transport.on("*", (event) => {
  // event.type: string
  // Full event object
})
```

### Function Calling

```typescript
transport.on("function_call", (call) => {
  // call.name: string
  // call.arguments: string (JSON)
  // call.callId: string

  // Execute and respond
  const result = await executeOnServer(call)
  transport.sendFunctionCallOutput(call, result)
})
```

## Client → Server Events

### Send Audio

```typescript
// Send audio chunk
transport.sendAudio(audioBuffer) // ArrayBuffer

// With commit (manual VAD)
transport.sendAudio(audioBuffer, { commit: true })
```

### Send Text

```typescript
transport.sendMessage("Hello!")
```

### Update Session

```typescript
transport.updateSessionConfig({
  voice: "echo",
  temperature: 0.6,
})
```

### Interrupt

```typescript
transport.interrupt()
```

## Raw Event Types

If using raw WebSocket (not recommended), these are the event shapes:

### Input Audio

```json
{
  "type": "input_audio_buffer.append",
  "audio": "<base64_pcm16_data>"
}
```

### Function Output

```json
{
  "type": "conversation.item.create",
  "item": {
    "type": "function_call_output",
    "call_id": "call_abc123",
    "output": "{\"result\": \"success\"}"
  }
}
```

Then trigger continuation:

```json
{
  "type": "response.create"
}
```

## Server Events (via SDK's `*` handler)

### VAD Events

```json
{
  "type": "input_audio_buffer.speech_started",
  "audio_start_ms": 1500,
  "item_id": "item_abc"
}
```

```json
{
  "type": "input_audio_buffer.speech_stopped",
  "audio_end_ms": 3200,
  "item_id": "item_abc"
}
```

### Transcription

```json
{
  "type": "conversation.item.input_audio_transcription.completed",
  "item_id": "item_abc",
  "transcript": "What is the weather like?"
}
```

### Response Audio

```json
{
  "type": "response.output_audio.delta",
  "response_id": "resp_abc",
  "item_id": "item_xyz",
  "delta": "<base64_audio_chunk>"
}
```

### Function Calling

```json
{
  "type": "response.function_call_arguments.done",
  "call_id": "call_123",
  "name": "read_file",
  "arguments": "{\"path\": \"/home/user/config.json\"}"
}
```

## Pricing (2025)

| Type         | Cost                                |
| ------------ | ----------------------------------- |
| Audio input  | $0.06 / minute (~100 tokens/second) |
| Audio output | $0.24 / minute (~200 tokens/second) |
| Text input   | Standard GPT-4o pricing             |
| Text output  | Standard GPT-4o pricing             |

A 1-minute conversation costs ~$0.30.

## Error Handling

| Code                   | Meaning               | Action             |
| ---------------------- | --------------------- | ------------------ |
| `invalid_api_key`      | Bad API key           | Check credentials  |
| `token_expired`        | Ephemeral key expired | Refresh token      |
| `rate_limit_exceeded`  | Too many requests     | Backoff and retry  |
| `invalid_audio_format` | Wrong encoding        | Check PCM16 format |
| `connection_closed`    | WebSocket dropped     | Reconnect          |

## References

- [OpenAI Realtime Guide](https://platform.openai.com/docs/guides/realtime)
- [Realtime API Reference](https://platform.openai.com/docs/api-reference/realtime)
- [Client Events](https://platform.openai.com/docs/api-reference/realtime-client-events)
- [Server Events](https://platform.openai.com/docs/api-reference/realtime-server-events)
