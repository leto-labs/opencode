# Architecture

## System Overview

The realtime architecture uses a **direct client connection** model:

- The web client connects **directly to OpenAI Realtime over WebRTC** for low-latency audio
- The OpenCode server handles **async HTTP** for ephemeral keys, transcripts, tool execution, and prompt/tool configuration

## Table of Contents

- [System Overview](#system-overview)
- [Message Flow](#message-flow)
- [Component Responsibilities](#component-responsibilities)
- [Why Direct Connection?](#why-direct-connection)
- [Security Model](#security-model)
- [Session Integration](#session-integration)
- [Audio Format](#audio-format)

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Web Client                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │ Audio Input  │  │ Audio Output │  │ OpenAI SDK               │  │
│  │ (Microphone) │  │ (Speaker)    │  │ (@openai/agents/realtime)│  │
│  └──────┬───────┘  └──────▲───────┘  └──────────┬───────────────┘  │
│         │                 │                      │                  │
│         └────────────┬────┴──────────────────────┘                  │
│                      │                                               │
└──────────────────────┼───────────────────────────────────────────────┘
                       │ WebRTC (direct to OpenAI)
                       │
┌──────────────────────┼───────────────────────────────────────────────┐
│ OpenAI Realtime API  │                                               │
│  ┌───────────────────▼────────────────────────────────────────────┐  │
│  │ gpt-4o-realtime-preview                                        │  │
│  │ - Audio understanding (native, not STT)                        │  │
│  │ - Response generation                                          │  │
│  │ - Audio synthesis (native, not TTS)                            │  │
│  │ - Voice Activity Detection (VAD)                               │  │
│  │ - Function calling                                             │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
                       ▲
                       │ HTTP (async)
                       │
┌──────────────────────┼───────────────────────────────────────────────┐
│ OpenCode Server      │                                               │
│  ┌───────────────────┴────────────────────────────────────────────┐  │
│  │ Session Routes (session-scoped)                                │  │
│  │ POST /session/:id/client_secret → Ephemeral key (cached)       │  │
│  │ GET  /session/:id/client_secret → Get cached key               │  │
│  │ POST /session/:id/transcript    → Persist transcripts          │  │
│  │ POST /session/:id/tool/call     → Execute tool                 │  │
│  │ GET  /session/:id/tools         → List available tools         │  │
│  │ GET  /session/:id/system_prompt → Fetch assembled instructions │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

## Message Flow

### Voice Conversation (User → Assistant)

```
1. Client captures microphone audio (24kHz PCM16)
2. Client sends audio directly to OpenAI via WebRTC
3. OpenAI detects speech end via VAD
4. OpenAI generates response audio
5. Client receives audio chunks, plays through speakers
6. Client sends transcript events to OpenCode server (async)
```

### Tool Execution Flow

```
1. User speaks: "Read the config file"
2. VAD detects silence → User turn ends
3. OpenAI generates function_call event
4. Client receives function_call, forwards to OpenCode server
5. Server executes tool, returns result
6. Client sends function_call_output to OpenAI
7. OpenAI continues response with tool result
8. Audio response plays
```

### Interruption Flow

```
1. Assistant is speaking (audio playing on client)
2. User starts speaking
3. OpenAI VAD detects user speech → sends speech_started event
4. Client stops audio playback immediately
5. OpenAI stops generating, processes new user input
6. User finishes speaking → speech_stopped event
7. OpenAI generates new response
```

## Component Responsibilities

### Web Client

| Component          | Responsibility                    |
| ------------------ | --------------------------------- |
| [`voice-mode.tsx`](../../packages/app/src/context/voice-mode.tsx) | Voice mode state, transcript persistence, UI updates |
| [`use-realtime-connection.ts`](../../packages/app/src/hooks/use-realtime-connection.ts) | WebRTC connection lifecycle + session config + history injection |
| Web Audio / `<audio>` element | Microphone capture + speaker playback (managed by `OpenAIRealtimeWebRTC`) |
| [`openai-realtime-tool.ts`](../../packages/app/src/util/openai-realtime-tool.ts) | Server tool definitions → executable `@openai/agents/realtime` tools |

### OpenCode Server

| Endpoint                          | Responsibility                  |
| --------------------------------- | ------------------------------- |
| `POST /session/:id/client_secret` | Generate ephemeral key (cached) |
| `GET /session/:id/client_secret`  | Get cached ephemeral key        |
| `POST /session/:id/transcript`    | Persist transcript parts        |
| `GET /session/:id/message`        | Retrieve message history        |
| `POST /session/:id/tool/call`     | Execute tool, return result     |
| `GET /session/:id/tools`          | List tools (voice-safe subset: `glob`, `grep`, `task`) |
| `GET /session/:id/system_prompt`  | Assembled instructions          |

### OpenAI Realtime API

| Feature             | Responsibility                                |
| ------------------- | --------------------------------------------- |
| Audio processing    | Native audio understanding (not STT)          |
| Response generation | LLM reasoning + audio synthesis               |
| VAD                 | Detect speech start/end, handle interruptions |
| Function calling    | Generate tool calls, wait for results         |

## Why Direct Connection?

A proxy architecture would route all traffic through the server:

```
Client ←→ Server ←→ OpenAI
```

**Problems with proxy approach:**

1. **Latency**: Each hop adds 50-200ms. Audio round-trip becomes 100-400ms slower.
2. **Complexity**: Server must handle WebSocket → WebSocket bridging.
3. **Scalability**: Server becomes bottleneck for all audio traffic.
4. **Failure modes**: Server outage breaks all voice sessions.

**Direct connection benefits:**

1. **Low latency**: Audio goes straight to OpenAI (~300ms total).
2. **Simplicity**: Server only handles async HTTP requests.
3. **Scalability**: Audio traffic bypasses server entirely.
4. **Resilience**: Server can be down, voice still works (except tools).

## Security Model

```
┌─────────────┐     1. Request token      ┌─────────────┐
│   Client    │ ─────────────────────────→│   Server    │
│             │                            │             │
│             │     2. Return ephemeral    │  (has main  │
│             │ ←─────────────────────────│   API key)  │
│             │        key (ek_...)        │             │
└──────┬──────┘                            └─────────────┘
       │
       │ 3. Connect with ephemeral key
       │
       ▼
┌─────────────┐
│   OpenAI    │
│  Realtime   │
└─────────────┘
```

- Main API key (`sk-...`) never leaves server
- Ephemeral keys (`ek-...`) are short-lived (~1 hour)
- Client refreshes token before expiry

## Session Integration

Realtime conversations integrate with existing opencode sessions:

1. **Session Creation**: Same as text mode
2. **Transcript Persistence**: Stored via `POST /session/:id/transcript` as normal `TextPart` parts (OpenCode tags these parts with `metadata.source: "realtime"` today).
3. **Tool Execution**: Same `Tool.execute()` pipeline
4. **Cost Tracking**: Not currently tracked for realtime transcripts (message `cost`/`tokens` are `0`); can be added later if needed.

### Message Structure

```typescript
// User speaks (transcribed)
{
  role: "user",
  parts: [
    {
      type: "text",
      text: "What's the weather?",
      metadata: {
        source: "realtime"
      }
    }
  ]
}

// Assistant responds (transcribed)
{
  role: "assistant",
  parts: [
    {
      type: "text",
      text: "Let me check the weather for you.",
      metadata: {
        source: "realtime"
      }
    },
    {
      type: "tool",
      tool: "get_weather",
      state: { status: "completed", ... }
    },
    {
      type: "text",
      text: "It's 72°F and sunny.",
      metadata: { source: "realtime" }
    }
  ]
}
```

> Note: The OpenAI Realtime API exposes richer event metadata (e.g. `item_id`, `response_id`, partial transcript deltas). OpenCode currently persists only the final transcript text + a simple `source` tag.

## Audio Format

| Direction | Format | Sample Rate | Channels | Encoding |
| --------- | ------ | ----------- | -------- | -------- |
| Input     | PCM16  | 24kHz       | Mono     | base64   |
| Output    | PCM16  | 24kHz       | Mono     | base64   |

The SDK handles encoding/decoding. Client uses Web Audio API for capture/playback.
