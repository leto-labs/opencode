# Phase 3: Client-Side Model Integration

**Status: COMPLETE**

## PRD

Integrate GPT Realtime as a selectable model in the UI. When selected:
- Auto-connect to realtime agent
- Show speaker and microphone controls
- Store all transcripts (text and voice) via server endpoint
- Load conversation history into realtime session

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│   Web Client                                                 │
│                                                              │
│  Model Picker → "GPT Realtime" selected                      │
│                        ↓                                     │
│              Auto-connect WebRTC                             │
│                                                              │
│  [Status Dot] [🔊 Speaker] [🎤 Microphone] [📞 Call]        │
└──────────────────────────┬──────────────────────────────────┘
                           │
    ┌──────────────────────┼──────────────────────┐
    │                      │                      │
    ▼                      ▼                      ▼
Text Input          Voice Input           Assistant Response
    │                      │                      │
    └──────────────────────┴──────────────────────┘
                           │
                           ▼
              POST /session/:id/transcript
```

## Tasks

- [x] Add GPT Realtime as client-side model with `clientSide` and `voice` flags
- [x] Auto-connect WebRTC when voice model selected
- [x] Speaker mute/unmute (output audio)
- [x] Microphone mute/unmute (input audio)
- [x] Status indicator matching Status popover design
- [x] Store user text transcripts via SDK
- [x] Store user voice transcripts (from `input_audio_transcription.completed`)
- [x] Store assistant transcripts (from `response.output_audio_transcript.done`)
- [x] Load conversation history into realtime session
- [x] Session-scoped ephemeral keys with caching
- [x] Auto-connect on text submit if not connected
- [x] Extract `useRealtimeConnection` hook

## Implementation Summary

### Model Flags
```typescript
// packages/app/src/context/local.tsx
export type LocalModel = Omit<Model, "provider"> & {
  provider: Provider
  clientSide?: boolean  // Inference on client, server for persistence
  voice?: boolean       // Audio I/O, needs WebRTC
}
```

### Ephemeral Key Endpoints (Session-Scoped)
```
POST /session/:sessionID/client_secret  - Create new token
GET  /session/:sessionID/client_secret  - Get cached token if valid
```

Token cached server-side with 55-minute TTL (OpenAI tokens expire in 1 hour).

### Output Modalities
OpenAI Realtime only supports `["text"]` OR `["audio"]`, not both together:
- Speaker muted → `["text"]` (text-only responses)
- Speaker unmuted → `["audio"]` (audio responses with transcript)

### Files Changed
| File | Purpose |
|------|---------|
| `packages/app/src/context/local.tsx` | Model flags, GPT Realtime injection |
| `packages/app/src/context/voice-mode.tsx` | Voice mode context, transcript storage |
| `packages/app/src/hooks/use-realtime-connection.ts` | WebRTC connection hook |
| `packages/app/src/components/prompt-input.tsx` | Voice UI, auto-connect on submit |
| `packages/opencode/src/session/client_secret.ts` | Ephemeral key management |
| `packages/opencode/src/server/routes/session.ts` | client_secret endpoints |
| `docs/architecture/storage.md` | Storage module documentation |

### Key Patterns

**Using SDK in hooks:**
```typescript
const sdk = useSDK()
await sdk.client.session.transcript.add({ sessionID, role, parts })
```

**Storage error handling:**
```typescript
try {
  const data = await Storage.read<T>(key)
} catch (err) {
  if (err instanceof Storage.NotFoundError) return null
  throw err
}
```

## Key Decisions

1. **Both mic and speaker enabled by default** - Natural UX for voice mode
2. **Auto-connect on submit** - User doesn't need to click phone button first
3. **Session-scoped tokens** - Tokens cached per session, not globally
4. **Consolidated transcript storage** - `voice-mode.tsx` handles all transcript logic
5. **History injection via `updateHistory()`** - Proper conversation context recovery
