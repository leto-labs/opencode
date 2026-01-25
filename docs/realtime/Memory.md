# OpenAI Realtime API Integration

## Overview

This branch (`claude/add-openai-realtime-3VC9u`) adds OpenAI Realtime API support to opencode for voice conversations. The implementation follows a phased TDD approach.

## Completed Phases

### Phase 1: Foundation Types
- Added `AudioPart` and `RealtimeEventPart` to `src/session/message-v2.ts`
- Added `ToolStateInterrupted` for interrupted tool executions
- Added `experimental.realtime` config section to `src/config/config.ts`

### Phase 2: Protocol & Transport
- `src/realtime/protocol.ts` - Zod schemas for all WebSocket events (client/server)
- `src/realtime/transport.ts` - WebSocket abstraction with OpenAI and Mock implementations

### Phase 3: Server Integration
- `src/realtime/session.ts` - RealtimeSession class bridging client WS to OpenAI
- `src/server/routes/realtime.ts` - REST + WebSocket endpoints
- Modified `src/server/server.ts` to mount `/realtime` routes
- Modified `src/share/share-next.ts` to filter audio/realtime_event parts

### Phase 4: Tool Integration
- `src/realtime/tools.ts` - Custom Zod v4 to JSON Schema converter (zod-to-json-schema doesn't support v4)
- Tool executor with validation, error handling, abort signal support
- Auto-execution wired into RealtimeSession
- VAD interruption handling (cancels pending tools on speech_started)

### Phase 5: Transcript Persistence
- `src/realtime/persistence.ts` - Handles transcript and VAD event persistence
- Saves user/assistant speech as TextPart (not audio - transcripts only)
- Saves VAD events as RealtimeEventPart
- Wired into RealtimeSession with `onTranscriptPart` callback

### Configuration Wiring (Latest)
- Added `model` field to `experimental.realtime` config
- Server routes now read config and use OpenAI provider API key automatically
- `apiKey` is optional in `/realtime/:sessionID/start` - falls back to env/config

## Pending Phases

### Phase 6a: Web Client (No Dependencies)
Uses Web Audio API for browser-based voice:
- `packages/app/src/realtime/client.ts` - WebSocket client
- `packages/app/src/realtime/audio-capture.ts` - AudioWorklet for PCM16 mic
- `packages/app/src/realtime/audio-playback.ts` - AudioContext queue
- `packages/app/src/realtime/use-realtime.ts` - Solid.js hook
- UI components for voice mode

### Phase 6b: CLI/TUI Client
Uses `@mastra/node-audio` for terminal voice:
- `src/realtime/audio-node.ts` - Mic/speaker wrappers
- `src/cli/cmd/tui/component/voice-mode.tsx` - TUI voice UI
- Keybind integration (e.g., Ctrl+V)

## Key Files

```
src/realtime/
├── index.ts           # Re-exports
├── protocol.ts        # Zod schemas for WebSocket events
├── transport.ts       # Transport interface + OpenAI + Mock
├── session.ts         # RealtimeSession class
├── tools.ts           # Zod→JSON Schema + tool executor
└── persistence.ts     # Transcript persistence

src/server/routes/
└── realtime.ts        # REST + WebSocket endpoints

test/realtime/
├── types.test.ts
├── config.test.ts
├── protocol.test.ts
├── transport.test.ts
├── session.test.ts
├── tools.test.ts
└── persistence.test.ts
```

## Test Status

118 tests passing across 7 test files.

## Technical Notes

- Zod v4 is used - has different internal structure than v3 (`def.type`, `def.shape`, `.issues` instead of `.errors`)
- OpenAI Realtime uses PCM16 audio at 24kHz
- The `zod-to-json-schema` package doesn't work with Zod v4, so we wrote a custom converter
- opencode has both a TUI (Solid.js in terminal via @opentui/solid) and a web app (packages/app)

## Configuration Example

```yaml
experimental:
  realtime:
    enabled: true
    model: gpt-4o-realtime-preview
    voice: alloy
    turn_detection: server_vad
    input_audio_format: pcm16
    output_audio_format: pcm16
    vad:
      threshold: 0.5
      prefix_padding_ms: 300
      silence_duration_ms: 500
```
