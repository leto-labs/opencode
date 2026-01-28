# Architecture Decisions

This document records key architecture decisions for the realtime integration.

---

## D1: Direct Client Connection

**Decision**: Client connects directly to OpenAI Realtime API. Server handles async operations only.

```
Client ←WebSocket→ OpenAI Realtime API (direct)
Client ←HTTP→ OpenCode Server (async: tools, storage, keys)
```

**Rationale**:

- **Latency**: Audio requires <500ms round-trip. Proxying would add 100-400ms.
- **Simplicity**: No WebSocket bridging complexity on server.
- **Scalability**: Audio traffic doesn't hit server.
- **Resilience**: Voice works even if server is slow/down (except tools).

**Trade-offs**:

- Client needs ephemeral key management
- Tool execution requires extra round-trip to server
- Transcript persistence is async (slight delay)

**Alternative Considered**: Server-side proxy would centralize control but adds unacceptable latency for voice.

---

## D2: Use Official OpenAI Agents SDK

**Decision**: Use `@openai/agents-realtime` SDK instead of raw WebSocket.

```typescript
import { OpenAIRealtimeWebSocket } from "@openai/agents-realtime"
```

**Rationale**:

- **Maintained by OpenAI**: Tracks API changes automatically
- **Type-safe**: Zod schemas for all events
- **Battle-tested**: Used in OpenAI's own demos
- **Features**: Built-in reconnection, audio handling, VAD events

**Trade-off**: External dependency, but OpenAI maintains it.

**Alternative Considered**: Raw WebSocket would avoid the dependency but requires maintaining our own event schemas and handling API format changes.

---

## D3: Ephemeral Keys for Production

**Decision**: Server generates short-lived tokens for client use.

```
1. Client → Server: Request token
2. Server → OpenAI: Create session with main API key
3. Server → Client: Return ephemeral key (ek_...)
4. Client → OpenAI: Connect with ephemeral key
```

**Rationale**:

- Main API key never exposed to client
- Ephemeral keys expire (~1 hour)
- Server controls which models/tools are available

**Development Exception**: Phase 1-3 use client-side API key for simplicity.

---

## D4: Audio Format Standardization

**Decision**: Use PCM16 @ 24kHz internally. SDK handles encoding.

**Rationale**:

- Native format for OpenAI Realtime API
- Web Audio API outputs 24kHz directly
- SDK handles base64 encoding/decoding

**Trade-off**: Higher bandwidth than Opus (~48KB/s vs ~6KB/s).

---

## D5: Transcript-Only Persistence

**Decision**: Persist transcripts only, not raw audio.

**Rationale**:

- Audio is large (~2.8MB per minute stereo)
- Transcripts are searchable
- Audio can be optionally stored via URL reference

**Trade-off**: No audio playback of history unless explicitly stored.

---

## D6: Server-Side Tool Execution

**Decision**: Tools execute on OpenCode server, not client.

```
1. OpenAI sends function_call to client
2. Client forwards to server via HTTP
3. Server executes tool (filesystem access, sandboxed)
4. Server returns result
5. Client sends result to OpenAI
```

**Rationale**:

- Server has filesystem access
- Tools run in controlled environment
- Consistent with text-mode tool execution
- Same permission system applies

**Trade-off**: Extra round-trip for tool calls (~50-200ms).

---

## D7: VAD Mode Default

**Decision**: Use server-side VAD with semantic detection.

```typescript
turnDetection: {
  type: "semantic_vad",
  eagerness: "medium"
}
```

**Rationale**:

- Semantic VAD detects natural sentence boundaries
- More natural than silence-based detection
- No client-side VAD implementation needed

**Alternative**: `server_vad` with threshold-based silence detection.

---

## D8: Interruption Handling

**Decision**: On user speech during assistant response, immediately stop playback.

**Flow**:

1. VAD detects user speech → `speech_started` event
2. Client stops audio playback
3. Client cancels pending tool executions
4. New user turn begins

**Rationale**:

- Matches natural conversation behavior
- User intent to interrupt is clear signal

---

## D9: Tool State Extension

**Decision**: Add `interrupted` state to ToolState.

```typescript
type ToolStatus = "pending" | "running" | "completed" | "error" | "interrupted"
```

**Rationale**:

- Distinguishes user interruption from errors
- Allows partial results to be preserved
- Better UX (show "interrupted" vs "failed")

---

## D10: Async Transcript Sync

**Decision**: Batch transcript events and sync periodically.

```typescript
// Sync every 1-2 seconds, not on every event
const SYNC_INTERVAL = 1000
```

**Rationale**:

- Reduces HTTP requests to server
- Transcript sync is not latency-sensitive
- Failed syncs can retry

**Trade-off**: Slight delay before transcripts appear in session history.

---

## D11: Reconnection Strategy

**Decision**: SDK handles reconnection with exponential backoff.

**Rationale**:

- SDK has built-in reconnection logic
- Handles transient network issues
- Client refreshes ephemeral key if expired

---

## D12: Cost Tracking

**Decision**: Track audio tokens separately from text tokens.

```typescript
tokens: {
  input: number,
  output: number,
  audio: {
    input: number,   // ~100 tokens/second
    output: number   // ~200 tokens/second
  }
}
```

**Rationale**:

- Audio tokens are 4-8x more expensive than text
- Users need visibility into costs
- Enables usage limits

---

## Open Questions

### Q1: Multi-turn Context on Reconnect

How much conversation history should be sent on reconnect?

- **Current**: Clean slate (OpenAI doesn't persist between connections)
- **Future**: Could inject recent transcript as text context

### Q2: Hybrid Text/Voice Mode

Should users switch between text and voice mid-conversation?

- **Current**: Separate modes
- **Future**: Seamless switching with shared context

### Q3: Offline Fallback

What happens when OpenAI is unreachable?

- **Current**: Voice doesn't work
- **Future**: Could fall back to local STT+TTS (expensive, complex)
