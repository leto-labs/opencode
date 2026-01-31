# OpenAI Realtime Voice Integration

Voice support for OpenCode using OpenAI's Realtime API with direct client connection architecture.

## Table of Contents

- [Overview](#overview)
- [Current Status](#current-status)
- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Key Files](#key-files)
- [Documentation](#documentation)
- [Conventions](#conventions)
- [Dependencies](#dependencies)

## Overview

- **Direct WebRTC connection** to OpenAI for ~300ms latency
- **Server-side tools and storage** - OpenCode server handles persistence and tool execution
- **Voice is a “call” overlay** - When a call is active, input is sent to OpenAI Realtime (`gpt-realtime`); when inactive, input uses the currently selected text model via the normal server endpoint.

## Current Status

| Phase                   | Focus                         | Status         |
| ----------------------- | ----------------------------- | -------------- |
| [Phase 1](./PHASE-1.md) | Voice mode button             | ✅ Complete    |
| [Phase 2](./PHASE-2.md) | Transcript & tool endpoints   | ✅ Complete    |
| [Phase 3](./PHASE-3.md) | Client-side model integration | ✅ Complete    |
| [Phase 4](./PHASE-4.md) | Voice tool calling            | 🔶 In progress |
| [Phase 5](./PHASE-5.md) | Production hardening          | 🔶 Partial     |

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
bun dev -- --port 4444
```

If the OpenAI provider is connected, use the phone/call controls in the prompt input to start a voice session.

## Key Files

### Client

| File                                                | Purpose                |
| --------------------------------------------------- | ---------------------- |
| [`packages/app/src/context/voice-mode.tsx`](../../packages/app/src/context/voice-mode.tsx)           | Voice mode context     |
| [`packages/app/src/hooks/use-realtime-connection.ts`](../../packages/app/src/hooks/use-realtime-connection.ts) | WebRTC connection hook |
| [`packages/app/src/util/openai-realtime-tool.ts`](../../packages/app/src/util/openai-realtime-tool.ts)         | Tool definitions + server relay |
| [`packages/app/src/context/local.tsx`](../../packages/app/src/context/local.tsx)                                | Model + agent selection (used for tool context) |

### Server

| File                                             | Purpose                  |
| ------------------------------------------------ | ------------------------ |
| [`packages/opencode/src/session/client_secret.ts`](../../packages/opencode/src/session/client_secret.ts) | Ephemeral key management |
| [`packages/opencode/src/session/transcript.ts`](../../packages/opencode/src/session/transcript.ts)       | Transcript storage       |
| [`packages/opencode/src/session/tool.ts`](../../packages/opencode/src/session/tool.ts)                   | Voice-safe tool list (`glob`, `grep`, `task`) + `/tool/call` execution |
| [`packages/opencode/src/server/routes/session.ts`](../../packages/opencode/src/server/routes/session.ts) | Session endpoints (`/client_secret`, `/transcript`, `/tools`, `/tool/call`, `/system_prompt`) |
| [`packages/opencode/src/tool/registry.ts`](../../packages/opencode/src/tool/registry.ts)                | Full tool registry (server-side inference + subagents) |

## Documentation

| Document                                  | Description         |
| ----------------------------------------- | ------------------- |
| [Architecture](./architecture.md)         | System design       |
| [OpenAI API](./openai-api.md)             | API reference       |
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
2. Regenerate SDK: `bun ./packages/sdk/js/script/build.ts`
3. Use generated client in app code

## Dependencies

- `@openai/agents` - OpenAI Realtime SDK (import from `@openai/agents/realtime`)
- `@openai/agents-realtime` - Event/type helpers (types only; used by some app code)
- Web Audio API for microphone/speaker
