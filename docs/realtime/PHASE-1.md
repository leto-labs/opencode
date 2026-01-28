# Phase 1: Voice Mode Foundation

**Status: COMPLETE**

## PRD

Add a voice mode button that connects to OpenAI Realtime API via WebRTC. Server provides ephemeral keys to keep the main API key secure.

## Tasks

- [x] Add `@openai/agents` package
- [x] Create `VoiceModeProvider` context with connection state
- [x] Add server endpoint for ephemeral keys
- [x] Add microphone button in prompt input
- [x] Log all events to console

## Implementation Summary

### Server

Ephemeral key generation (refactored in Phase 3):

- `POST /session/:id/client_secret` - Create new token
- `GET /session/:id/client_secret` - Get cached token
- Logic in `packages/opencode/src/session/client_secret.ts`

### Client

- `VoiceModeProvider` - Manages WebRTC connection state
- `OpenAIRealtimeWebRTC` transport with hidden audio element
- Microphone button toggles connection

### Files Changed

| File                                             | Purpose                  |
| ------------------------------------------------ | ------------------------ |
| `packages/opencode/src/session/client_secret.ts` | Ephemeral key management |
| `packages/opencode/src/server/routes/session.ts` | client_secret endpoints  |
| `packages/app/src/context/voice-mode.tsx`        | VoiceModeProvider        |
| `packages/app/src/app.tsx`                       | Provider wrapper         |
| `packages/app/src/components/prompt-input.tsx`   | Microphone button        |

## Key Decisions

1. **Direct client connection** - Audio goes directly to OpenAI for low latency (~300ms)
2. **Ephemeral keys** - Server generates short-lived tokens, main API key never exposed
3. **WebRTC transport** - Using `OpenAIRealtimeWebRTC` from `@openai/agents/realtime`
4. **Session-scoped tokens** - Keys cached per session with 55-min TTL (refactored in Phase 3)
