# OpenAI Realtime API Reference

This document summarizes the OpenAI Realtime API as used in opencode.

## Table of Contents

- [Connection](#connection)
- [Audio Format](#audio-format)
- [Session Configuration](#session-configuration)
- [SDK Events](#sdk-events)
- [Client → Server Events](#client--server-events)
- [Raw Event Types](#raw-event-types)
- [Server Events (via SDK's `*` handler)](#server-events-via-sdks--handler)
- [Pricing (snapshot)](#pricing-snapshot)
- [Error Handling](#error-handling)
- [References](#references)

## Connection

OpenCode uses **WebRTC** via OpenAI’s Agents SDK, backed by OpenAI’s Realtime API. Ephemeral keys are created server-side via:

- [`packages/opencode/src/session/client_secret.ts`](../../packages/opencode/src/session/client_secret.ts) (calls `POST https://api.openai.com/v1/realtime/client_secrets`)
- Exposed as `POST /session/:id/client_secret` + `GET /session/:id/client_secret` in [`packages/opencode/src/server/routes/session.ts`](../../packages/opencode/src/server/routes/session.ts)

**With SDK**:

```typescript
import { RealtimeSession, RealtimeAgent, OpenAIRealtimeWebRTC } from "@openai/agents/realtime"

// Provide an <audio> element for playback
const audioElement = document.createElement("audio")
audioElement.autoplay = true
document.body.appendChild(audioElement)

const agent = new RealtimeAgent({
  name: "OpenCode",
  instructions: "You are a helpful assistant.",
  tools: [],
})

const transport = new OpenAIRealtimeWebRTC({ audioElement })

const session = new RealtimeSession(agent, {
  transport,
  model: "gpt-realtime",
  config: {
    outputModalities: ["audio"],
    audio: {
      input: {
        transcription: { model: "gpt-4o-transcribe" },
        turnDetection: { type: "semantic_vad", eagerness: "medium" },
      },
      output: { voice: "cedar", speed: 1.0 },
    },
  },
})

await session.connect({ apiKey: "ek_..." })
```

> Note: WebSocket transports exist, but OpenCode’s current implementation is WebRTC-first (see [`packages/app/src/hooks/use-realtime-connection.ts`](../../packages/app/src/hooks/use-realtime-connection.ts)).

## Audio Format

| Direction | Format | Sample Rate | Channels | Encoding |
| --------- | ------ | ----------- | -------- | -------- |
| Input     | PCM16  | 24kHz       | Mono     | base64   |
| Output    | PCM16  | 24kHz       | Mono     | base64   |

Also supported: G.711 (µ-law and A-law) for telephony.

## Session Configuration

Sent via `session.update` after connection:

```typescript
// Wire format (snake_case) shown for reference.
// In this repo we mostly configure via the Agents SDK (camelCase), see:
// - packages/app/src/hooks/use-realtime-connection.ts
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

The OpenAI Agents SDK (`@openai/agents/realtime`) provides typed events (and OpenCode primarily listens via `RealtimeSession` events like `transport_event`).

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

## Pricing (snapshot)

This section is a historical estimate from when the feature was built. Always confirm pricing in the official OpenAI docs before relying on it for product decisions.

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
