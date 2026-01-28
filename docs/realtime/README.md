# OpenAI Realtime Voice Integration

Voice support for OpenCode using OpenAI's Realtime API with direct client connection architecture.

## Overview

- **Direct WebRTC connection** to OpenAI for ~300ms latency
- **Server-side tools and storage** - OpenCode server handles persistence and tool execution
- **GPT Realtime as model** - Selectable in model picker, auto-connects when selected

## Current Status

| Phase | Focus | Status |
|-------|-------|--------|
| [Phase 1](./PHASE-1.md) | Voice mode button | ✅ Complete |
| [Phase 2](./PHASE-2.md) | Transcript & tool endpoints | ✅ Complete |
| [Phase 3](./PHASE-3.md) | Client-side model integration | ✅ Complete |
| [Phase 4](./PHASE-4.md) | Voice tool calling | 🔲 Not started |
| [Phase 5](./PHASE-5.md) | Production hardening | 🔶 Partial |

## Architecture

```
┌─────────────────┐      WebRTC (direct)      ┌─────────────────┐
│   Web Client    │◄────────────────────────►│  OpenAI Realtime│
│                 │         (~300ms)          │       API       │
│  🎤 Microphone  │                           │  - VAD          │
│  🔊 Speaker     │                           │  - STT/TTS      │
└────────┬────────┘                           └─────────────────┘
         │
         │ HTTP (async)
         │  - Transcript persistence
         │  - Tool execution
         │  - Ephemeral keys
         ▼
┌─────────────────┐
│  OpenCode Server│
└─────────────────┘
```

## Quick Start

```bash
# Terminal 1: Start server
cd packages/opencode
bun run --conditions=browser ./src/index.ts serve --port 4096

# Terminal 2: Start UI
cd packages/app
bun dev
```

Select "GPT Realtime" from the model picker to enable voice mode.

## Key Files

### Client
| File | Purpose |
|------|---------|
| `packages/app/src/context/voice-mode.tsx` | Voice mode context |
| `packages/app/src/hooks/use-realtime-connection.ts` | WebRTC connection hook |
| `packages/app/src/context/local.tsx` | Model injection |

### Server
| File | Purpose |
|------|---------|
| `packages/opencode/src/session/client_secret.ts` | Ephemeral key management |
| `packages/opencode/src/session/transcript.ts` | Transcript storage |
| `packages/opencode/src/server/routes/session.ts` | All session endpoints |

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](./architecture.md) | System design |
| [OpenAI API](./openai-api.md) | API reference |
| [Tool Integration](./tool-integration.md) | Tools in voice mode |

## Conventions

### SDK Pattern
All API calls use the generated SDK client:
```typescript
const sdk = useSDK()
await sdk.client.session.transcript.add({ sessionID, role, parts })
```

### Adding Routes
1. Add route in `packages/opencode/src/server/routes/*.ts`
2. Regenerate SDK: `cd packages/sdk/js && bun run build`
3. Use generated client in app code

## Dependencies

- `@openai/agents` - OpenAI Realtime SDK (import from `@openai/agents/realtime`)
- Web Audio API for microphone/speaker
