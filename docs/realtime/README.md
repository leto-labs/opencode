# OpenAI Realtime API Integration

This documentation covers voice support for opencode using OpenAI's Realtime API with a **direct client connection architecture**.

## Overview

Unlike traditional TTS/STT workflows, the Realtime API provides:
- **Native bidirectional audio streaming** via WebSocket/WebRTC
- **Server-side Voice Activity Detection (VAD)** for natural turn-taking
- **Interruption support** - users can interrupt the assistant mid-response
- **Integrated tool calling** during voice conversations
- **~300-500ms end-to-end latency** vs 1.5-4s for STT+LLM+TTS pipelines

## Architecture

The web client connects **directly** to OpenAI for audio, while the OpenCode server handles async operations.

```
┌─────────────────┐      WebRTC/WS (direct)      ┌─────────────────┐
│   Web Client    │◄────────────────────────────►│  OpenAI Realtime│
│                 │         (~300ms)              │       API       │
│  🎤 Microphone  │                               │                 │
│  🔊 Speaker     │                               │  - VAD          │
│  📝 Transcript  │                               │  - STT/TTS      │
└────────┬────────┘                               └─────────────────┘
         │
         │ HTTP (async, latency-tolerant)
         │  - Transcript persistence
         │  - Tool execution
         │  - Ephemeral key generation
         ▼
┌─────────────────┐
│  OpenCode Server│
│                 │
│  - Storage      │
│  - Tool Runner  │
│  - Key Manager  │
└─────────────────┘
```

### Why Direct Connection?

Voice requires ultra-low latency. Proxying audio through a server adds 100-400ms per round-trip, pushing total latency to 700-900ms - unacceptable for natural conversation.

**Direct connection** keeps audio fast while using the server for:
- **Ephemeral keys**: Main API key stays server-side
- **Tool execution**: Server has filesystem access, runs sandboxed
- **Persistence**: Transcripts stored asynchronously

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](./architecture.md) | Detailed system design |
| [Decisions](./decisions.md) | Key decisions and trade-offs |
| [OpenAI API](./openai-api.md) | API reference and events |
| [Tool Integration](./tool-integration.md) | How tools work in voice mode |
| [Types](./types.md) | TypeScript type definitions |
| [Why Realtime](./why-realtime.md) | Why not STT+LLM+TTS |

## Implementation Phases

| Phase | Focus | Server Role |
|-------|-------|-------------|
| [Phase 1](./PHASE-1.md) | Text chat via SDK | None (dev only) |
| [Phase 2](./PHASE-2.md) | Transcript sync | Storage |
| [Phase 3](./PHASE-3.md) | Voice I/O | Storage |
| [Phase 4](./PHASE-4.md) | Tool execution | Storage + Execution |
| [Phase 5](./PHASE-5.md) | Ephemeral keys | Security + Storage + Execution |

## Quick Start

```typescript
// Client-side (development only - uses raw API key)
import { OpenAIRealtimeWebSocket } from "@openai/agents-realtime"

const transport = new OpenAIRealtimeWebSocket({
  apiKey: "sk-...",
  model: "gpt-4o-realtime-preview",
  useInsecureApiKey: true,
})

await transport.connect({
  initialSessionConfig: {
    voice: "alloy",
    instructions: "You are a helpful assistant.",
  },
})

// Send text (Phase 1)
transport.sendMessage("Hello!")

// Send audio (Phase 3)
transport.sendAudio(pcm16AudioBuffer)
```

## Development

Start the dev servers in two separate terminals:

```bash
# Terminal 1: Start the opencode server (from packages/opencode)
cd packages/opencode
bun run --conditions=browser ./src/index.ts serve --port 4096

# Terminal 2: Start the dev UI (from packages/app)
cd packages/app
bun dev
```

## File Structure

```
docs/realtime/              # Documentation (this folder)
├── README.md
├── architecture.md
├── decisions.md
├── openai-api.md
├── tool-integration.md
├── types.md
├── why-realtime.md
└── PHASE-*.md

src/realtime/               # Server implementation
└── server/
    ├── routes.ts           # API endpoints
    ├── transcript.ts       # Persistence
    ├── tools.ts            # Tool execution
    └── ephemeral.ts        # Key generation

packages/web/src/           # Client implementation
└── hooks/
    ├── useRealtime.ts
    ├── useAudioCapture.ts
    └── useAudioPlayback.ts
```

## Dependencies

- `@openai/agents-realtime` - OpenAI's official Realtime SDK
- Web Audio API for microphone/speaker access
- Existing opencode session/storage system

## Conventions (IMPORTANT)

As this is a fork, we must **maintain conventions** with the upstream codebase.

### General Principle

Maintaining conventions is a **general principle** that extends beyond the specific patterns documented here. This includes but is not limited to:

- **Naming**: Follow existing naming conventions for files, functions, variables, and types
- **Structure**: Match the existing directory and file organization patterns
- **Patterns**: Use the same architectural patterns (SDK generation, context providers, etc.)
- **Testing**: Follow existing test structure and naming conventions
- **Error handling**: Match existing error handling patterns
- **Imports**: Use the same import patterns and aliases (e.g., `@/context/...`)

When in doubt, look at how similar functionality is implemented elsewhere in the codebase and follow that pattern. The goal is to keep our changes as aligned as possible with the parent source to minimize merge conflicts and maintain consistency.

### SDK Pattern
All API calls from the client MUST use the generated SDK client, not raw `fetch()`:
```typescript
// CORRECT - Use SDK client
await sdk.client.session.transcriptAdd({ sessionID, role, text })

// WRONG - Raw fetch doesn't include proper headers
await fetch(`${url}/session/${id}/transcript`, { ... })
```

### Adding New Routes
When adding new server routes:
1. Add the route in `packages/opencode/src/server/routes/*.ts`
2. **Regenerate the SDK**: `cd packages/sdk/js && bun run build`
3. Use the generated client in app code
4. Add tests following existing patterns

See [Architecture: Adding Routes](../architecture/adding-routes.md) for details.

### Testing
New endpoints should have tests in `packages/opencode/test/server/`.

## Links

- [OpenAI Realtime Guide](https://platform.openai.com/docs/guides/realtime)
- [OpenAI Agents SDK](https://github.com/openai/openai-agents-js)
- [Realtime API Reference](https://platform.openai.com/docs/api-reference/realtime)
