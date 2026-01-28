# Phase 3: Client-Side Model Integration

**Status: MOSTLY COMPLETE** - Core functionality working, remaining issues documented below

## Goal

Integrate GPT Realtime as a selectable model in the UI. When selected:
- Auto-connect to the realtime agent
- Route text messages through transcript endpoint AND send to realtime agent
- Show speaker (audio output) and microphone (audio input) control buttons
- Store assistant responses via transcript endpoint

## Architecture

```
┌─────────────────────────────────────────────────┐
│   Web Client                                    │
│                                                 │
│  Model Picker ──── "GPT Realtime" selected      │
│  ├── Sonnet                                     │
│  ├── Opus                                       │
│  └── GPT Realtime (client-side)                 │
│                    ↓                            │
│           Auto-connect to agent                 │
│                                                 │
│  [🔊 Speaker] [🎤 Microphone]                   │
│   └── mute/unmute output  └── muted (slash) /   │
│                               recording (red)    │
└─────────────────┬───────────────────────────────┘
                  │
                  ├──── Text input ───► POST /session/:id/transcript
                  │                     + voiceMode.sendText()
                  │
                  └──── Voice input ──► Handled by WebRTC transport
                                        history_added → POST transcript
```

## Key Insight

Models come from `providers.connected()` which fetches from the server. GPT Realtime is **client-side only** - OpenAI Realtime API doesn't work with server-side inference.

**Simplest approach**: Inject the "GPT Realtime" model into the client-side model list as a pseudo-model. Detect when selected and change message routing behavior.

## Implementation

### Step 1: Add Client-Side Model to Model List

Modify `packages/app/src/context/local.tsx`:

```typescript
// In the model section, after `available` memo:
const clientSideModels = createMemo(() => [
  {
    id: "gpt-realtime",
    name: "GPT Realtime",
    provider: {
      id: "openai-realtime",
      name: "OpenAI Realtime",
      // ... minimal provider shape
    },
    clientSide: true,  // Flag to identify client-side models
  },
])

// Merge into `list` memo
const list = createMemo(() => [
  ...available().map(m => ({ ...m, clientSide: false })),
  ...clientSideModels(),
])
```

**Key files to modify:**
- `packages/app/src/context/local.tsx:114-332` - Model state management
- `packages/app/src/hooks/use-providers.ts` - May need to expose a way to add client-side providers

### Step 2: Detect Client-Side Model in Prompt Input

Modify `packages/app/src/components/prompt-input.tsx`:

```typescript
// Add helper to check if current model is client-side
const isClientSideModel = createMemo(() => {
  const model = local.model.current()
  return model?.clientSide === true
})

// Show voice mode button only when GPT Realtime is selected
<Show when={isClientSideModel()}>
  <Tooltip placement="top" value="Voice mode">
    <Button
      type="button"
      variant="ghost"
      class="size-6"
      classList={{
        "text-12-success": voiceMode.status() === "connected",
        "animate-pulse": voiceMode.status() === "connecting",
      }}
      onClick={() => voiceMode.toggle()}
      aria-label="Voice mode"
    >
      <Icon name="microphone" class="size-4.5" />
    </Button>
  </Tooltip>
</Show>
```

### Step 3: Route Messages Through Transcript Endpoint

In `handleSubmit` of `packages/app/src/components/prompt-input.tsx`:

```typescript
// After all the setup code, before sending:

if (isClientSideModel()) {
  // Use transcript endpoint instead of prompt endpoint
  clearInput()
  addOptimisticMessage()

  // 1. Store user message via transcript endpoint
  await client.fetch(`/session/${session.id}/transcript`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      role: "user",
      text,
      metadata: { source: "text" },
    }),
  })

  // 2. Send to realtime agent (if connected)
  if (voiceMode.status() === "connected") {
    voiceMode.sendText(text)  // Need to add this method
  }

  // Note: Assistant response handling will come from voice-mode events
  // and will call the transcript endpoint with role: "assistant"
  return
}

// Existing server-side prompt flow...
```

### Step 4: Add Text Input to Voice Mode

Modify `packages/app/src/context/voice-mode.tsx`:

```typescript
// Add sendText method to send text input to realtime session
const sendText = (text: string) => {
  if (!session || status() !== "connected") return

  // Use RealtimeSession's text input capability
  session.sendText(text)
}

return {
  status,
  error,
  toggle,
  connect,
  disconnect,
  sendText,  // NEW
}
```

### Step 5: Store Assistant Responses as Transcripts

Modify `packages/app/src/context/voice-mode.tsx` to call transcript endpoint on responses:

```typescript
// In connect(), after setting up event handlers:
session.on("history_added", async (item: unknown) => {
  console.log("[voice] history_added", item)

  // Extract transcript from history item
  const historyItem = item as { role?: string; content?: string }
  if (!historyItem.role || !historyItem.content) return

  // Store transcript on server
  const sessionID = getCurrentSessionID()  // Need to pass this in
  if (!sessionID) return

  await fetch(`${server.url}/session/${sessionID}/transcript`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      role: historyItem.role,
      text: historyItem.content,
      metadata: { source: "realtime" },
    }),
  })
})
```

## Tasks

1. **Add client-side model to picker**
   - Inject GPT Realtime model into `local.model.list()`
   - Add `clientSide` flag to model type
   - Ensure it appears in model picker UI

2. **Conditional voice button**
   - Show mute/unmute button only when GPT Realtime selected
   - Hide for server-side models

3. **Route text messages**
   - Detect client-side model in `handleSubmit`
   - Use transcript endpoint + `voiceMode.sendText()` instead of prompt endpoint

4. **Store assistant responses**
   - Listen to realtime session events
   - POST transcripts to server for storage

5. **UI updates**
   - Messages should appear in chat UI from transcript sync
   - Consider optimistic updates for user messages

## Success Criteria

- [x] "GPT Realtime" appears in model picker
- [x] Audio control buttons only shown when GPT Realtime selected
- [x] Auto-connect to realtime agent when GPT Realtime is selected
- [x] Text messages route through transcript endpoint when using GPT Realtime
- [x] Text messages are sent to realtime agent (via `voiceMode.sendText()`)
- [x] Speaker button (mute/unmute audio output)
- [x] Microphone button with distinct visual states (muted with slash / recording)
- [x] SDK pattern used for all API calls (regenerated SDK, updated client code)
- [x] Assistant responses stored via transcript endpoint (captured from `response.output_audio_transcript.done` event)
- [x] Messages appear in chat UI (both user and assistant messages persist after refresh)
- [x] Real-time UI updates for assistant messages (fixed: directory-specific SDK client for SSE event routing)
- [x] User voice input transcripts stored (capture `input_audio_transcription.completed`)
- [x] Transcript storage consolidated in voice-mode.tsx
- [x] Conversation context available when switching to realtime mid-conversation
- [x] Session switching reconnects WebRTC with fresh history

## Implementation Summary

### Completed

| Feature | Status | Notes |
|---------|--------|-------|
| GPT Realtime model in picker | ✅ | Injected as client-side model |
| Auto-connect on model select | ✅ | Connects when GPT Realtime selected |
| Text input to realtime agent | ✅ | `voiceMode.sendText()` |
| User **text** transcript storage | ✅ | Via `voiceMode.sendText()` in voice-mode.tsx |
| User **voice** transcript storage | ✅ | Capturing `input_audio_transcription.completed` |
| Assistant transcript storage | ✅ | Captured from `response.output_audio_transcript.done` |
| Speaker mute/unmute | ✅ | `audioElement.muted` |
| Microphone mute/unmute | ✅ | `transport.mute()` with visual states |
| Real-time UI updates | ✅ | Fixed with directory-specific SDK client |
| Optimistic updates | ✅ | Client-generated IDs passed to server |
| Message persistence | ✅ | Both user and assistant messages survive refresh |
| Code structure | ✅ | Transcript storage consolidated in voice-mode.tsx |
| Session switching | ✅ | Auto-disconnect/reconnect when session changes |

### Remaining Issues

| Issue | Priority | Description |
|-------|----------|-------------|
| ~~User voice input not transcribed~~ | ~~High~~ | ✅ FIXED - Capturing `input_audio_transcription.completed` |
| ~~Code structure cleanup~~ | ~~High~~ | ✅ FIXED - Consolidated in voice-mode.tsx |
| ~~Conversation context recovery~~ | ~~High~~ | ✅ FIXED - Loading session history into agent instructions |
| ~~Session switching~~ | ~~High~~ | ✅ FIXED - Auto-disconnect/reconnect when `params.id` changes |
| Session cleared on disconnect | Low | Toggling voice mode off clears realtime session |

## Files to Modify

| File | Changes |
|------|---------|
| `packages/app/src/context/local.tsx` | Add client-side model injection |
| `packages/app/src/components/prompt-input.tsx` | Conditional routing, conditional voice button |
| `packages/app/src/context/voice-mode.tsx` | Add `sendText()`, transcript storage for responses |

## Key Files to Reference

| File | What to look at |
|------|-----------------|
| `packages/app/src/context/local.tsx:114-332` | Model state management |
| `packages/app/src/hooks/use-providers.ts` | How providers are fetched |
| `packages/app/src/components/dialog-select-model.tsx` | Model picker UI |
| `packages/app/src/components/prompt-input.tsx:1103-1591` | Message submission flow |
| `packages/opencode/src/server/routes/session.ts:940-1060` | Transcript endpoint |

## Notes

- No audio capture/playback in this phase - transcripts only
- If user wants to hear a response again, they can ask the agent to repeat
- Realtime events are logged to console (from Phase 1) - we just need to store them
- SDK client doesn't have transcript endpoint yet - use raw fetch for now

## Clarified Behavior

When GPT Realtime model is selected:
1. **Auto-connect**: Automatically connect to the realtime agent (audio input muted by default via `transport.mute(true)`)
2. **Text messages**: Stored as transcripts AND sent to the realtime agent
3. **Two audio control buttons**:
   - 🎤 **Microphone** - mute/unmute audio INPUT (voice capture from user) - uses `transport.mute(boolean)` for actual WebRTC audio track control
   - 🔊 **Speaker** - mute/unmute audio OUTPUT (agent voice playback) - uses `audioElement.muted`

## Known Issues (To Fix Later)

- **Session cleared on disconnect**: When toggling voice mode off, the realtime session is cleared. Should preserve session or reconnect gracefully.
- **Session switching**: Need to handle disconnecting/reconnecting when switching between sessions in the tab bar.
- ~~**Duplicate user messages**: User messages may appear twice in the UI (optimistic update + SSE event). Need deduplication logic.~~ **FIXED** - see "Duplicate User Messages Fix" below.
- ~~**Conversation context not available to realtime agent**~~: ✅ FIXED - Session history is now loaded and injected into agent instructions when connecting.

## Real-Time UI Updates

### Problem & Solution

Real-time UI updates rely on Server-Sent Events (SSE) to push `message.updated` and `message.part.updated` events from the server to the client. The key issue was that `VoiceModeProvider` was using `useGlobalSDK()` which creates a client WITHOUT the `x-opencode-directory` header.

When the transcript endpoint was called without the directory header:
1. Server fell back to `process.cwd()` as the directory
2. SSE events were published to the wrong directory
3. Client was listening for events on the actual project directory
4. Directory mismatch = events not received

### Fix Applied

Use a **directory-specific SDK client** in `voice-mode.tsx` for all API calls that need SSE event routing:

```typescript
// In voice-mode.tsx
const getDirectoryClient = () => {
  const directory = currentDirectory()
  if (!directory) return null
  return createOpencodeClient({
    baseUrl: globalSDK.url,
    fetch: platform.fetch,
    directory, // This sets the x-opencode-directory header
  })
}

// For transcript storage (requires directory for SSE routing)
const storeTranscript = async (role: "user" | "assistant", text: string) => {
  const client = getDirectoryClient()
  if (!client) return // Directory not set yet
  await client.session.transcript.add({ sessionID, role, text, metadata: { source: "realtime" } })
}

// For ephemeral key (falls back to global client if no directory)
const fetchEphemeralKey = async () => {
  const client = getDirectoryClient() ?? globalSDK.client
  const response = await client.realtime.session()
  return response.data?.value
}
```

The directory is set via `voiceMode.setSessionContext(sessionID, directory)` when a message is submitted, before any API calls that need SSE event routing.

## Resolved: SDK Pattern vs Raw Fetch

### Problem (RESOLVED)

We initially used raw `fetch()` calls which returned HTML instead of JSON (SPA fallback). The root cause was that the SDK wasn't regenerated after adding new server routes.

### Solution Applied

1. **Regenerated the SDK**: `cd packages/sdk/js && bun run build`
2. **Updated client code** to use SDK pattern:

```typescript
// prompt-input.tsx - Store user transcript
await sdk.client.session.transcript.add({
  sessionID: session.id,
  role: "user",
  text,
  metadata: { source: "text" },
})

// voice-mode.tsx - Store assistant transcript
await globalSDK.client.session.transcript.add({
  sessionID,
  role,
  text,
  metadata: { source: "realtime" },
})

// voice-mode.tsx - Get ephemeral key
const response = await globalSDK.client.realtime.session()
const ephemeralKey = response.data?.value
```

### Why This Matters

1. **Consistency**: All API calls now use the SDK pattern
2. **Type Safety**: Generated types ensure correct request/response shapes
3. **Headers**: SDK automatically includes `x-opencode-directory` header
4. **Error Handling**: SDK provides consistent error handling
5. **Maintainability**: Following conventions makes the codebase easier to maintain

### Files Updated

| File | Change |
|------|--------|
| `packages/sdk/js/src/v2/gen/*` | Regenerated with transcript & realtime types |
| `packages/app/src/components/prompt-input.tsx` | Uses `sdk.client.session.transcript.add()` |
| `packages/app/src/context/voice-mode.tsx` | Uses `globalSDK.client.session.transcript.add()` and `globalSDK.client.realtime.session()` |

## Assistant Transcript Capture

The assistant's audio responses are captured via the `transport_event` listener:

```typescript
session.on("transport_event", (event: { type: string; transcript?: string }) => {
  // Capture complete assistant transcript when audio response is done
  if (event.type === "response.output_audio_transcript.done" && event.transcript) {
    console.log("[voice] assistant transcript complete:", event.transcript.substring(0, 50) + "...")
    void storeTranscript("assistant", event.transcript)
  }
})
```

The OpenAI Realtime API sends transcript events:
- `response.output_audio_transcript.delta` - Incremental transcript chunks
- `response.output_audio_transcript.done` - Complete transcript for the audio output

We capture the `.done` event which contains the full transcript text.

## Duplicate User Messages Fix

### Problem

User messages were appearing twice in the UI when using the realtime model:
1. Optimistic message added immediately by the client
2. SSE event from server creating a "new" message

This happened because the client wasn't passing the `messageID` to the transcript endpoint. Traditional agents pass `messageID` to the prompt endpoint, allowing the server to use the same ID and have the SSE event update the existing optimistic message rather than insert a new one.

### Solution

Pass the client-generated `messageID` and `partID` to the transcript endpoint:

```typescript
// prompt-input.tsx - sendClientSideMessage
const transcriptResponse = await sdk.client.session.transcript.add({
  sessionID: session.id,
  role: "user",
  text,
  metadata: { source: "text" },
  messageID,        // Same ID used for optimistic message
  partID: textPart.id,  // Same ID used for optimistic part
})
```

The server already accepted these optional parameters (added in session.ts), so the fix was:
1. Regenerate SDK to include `messageID` and `partID` in transcript types
2. Update client to pass these IDs when storing user transcripts

### Why This Works

The SSE reconciliation logic in the sync store uses binary search on message IDs:
- If the ID exists → update the existing message
- If the ID doesn't exist → insert a new message

By passing the same `messageID` used for the optimistic message, the SSE event updates the existing entry instead of creating a duplicate.

## Code Structure Refactoring (COMPLETED)

### Problem (Resolved)

The current implementation splits transcript storage logic across two files:

| File | Responsibility | Issue |
|------|---------------|-------|
| `prompt-input.tsx` | Stores **user text** transcripts | Direct SDK call in component |
| `voice-mode.tsx` | Stores **assistant** transcripts | `storeTranscript()` only handles assistant |

Additionally, **user voice input is never transcribed**:
- OpenAI Realtime sends `conversation.item.input_audio_transcription.completed` for user speech
- We only listen for `response.output_audio_transcript.done` (assistant)
- User voice transcripts are lost

### Current Flow (Problematic)

```
┌─────────────────────────────────────────────────────────────────────┐
│  Text Input                                                         │
│                                                                     │
│  prompt-input.tsx                                                   │
│  ├─ sdk.client.session.transcript.add({ role: "user", ... })  ◄─── Split here
│  └─ voiceMode.sendText(text)                                        │
│                                                                     │
│  voice-mode.tsx                                                     │
│  └─ storeTranscript("assistant", ...) ◄───────────────────────────── And here
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  Voice Input                                                        │
│                                                                     │
│  [microphone] → OpenAI Realtime → input_audio_transcription         │
│                                   .completed                        │
│                                        │                            │
│                                        ▼                            │
│                                   NOT CAPTURED ❌                   │
└─────────────────────────────────────────────────────────────────────┘
```

### Solution: Consolidate in voice-mode.tsx

**Principle:** `voice-mode.tsx` owns ALL transcript management for realtime mode, mirroring how the server-side prompt endpoint owns message handling.

```
┌─────────────────────────────────────────────────────────────────────┐
│  Server-side Model                                                  │
│                                                                     │
│  prompt-input.tsx ──POST /session/:id/message──► Server handles all │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  Client-side Model (Realtime)                                       │
│                                                                     │
│  prompt-input.tsx ──voiceMode.sendText()──► voice-mode.tsx handles  │
│                                              all storage + sending  │
└─────────────────────────────────────────────────────────────────────┘
```

### Changes Required

**1. Modify `sendText()` in voice-mode.tsx:**

```typescript
// Before: Just sends to agent
const sendText = (text: string) => {
  session.sendMessage(text)
  return true
}

// After: Stores transcript AND sends to agent
const sendText = async (text: string, options?: {
  messageID?: string
  partID?: string
}): Promise<boolean> => {
  // Store user transcript (with IDs for optimistic update deduplication)
  await storeTranscript("user", text, options?.messageID, options?.partID)

  // Send to realtime agent
  session.sendMessage(text)
  return true
}
```

**2. Add user voice input listener in voice-mode.tsx:**

```typescript
session.on("transport_event", (event) => {
  // User voice input transcription (NEW)
  if (event.type === "conversation.item.input_audio_transcription.completed"
      && event.transcript) {
    addUserMessageToUI(event.transcript)
    void storeTranscript("user", event.transcript)
  }

  // Assistant transcription (existing)
  if (event.type === "response.output_audio_transcript.done"
      && event.transcript) {
    addAssistantMessageToUI(event.transcript)
    void storeTranscript("assistant", event.transcript)
  }
})
```

**3. Simplify prompt-input.tsx:**

```typescript
// Before: Component handles transcript storage
if (isClientSideModel()) {
  await sdk.client.session.transcript.add({ ... })  // Remove this
  voiceMode.sendText(text)
}

// After: Just call sendText, voice-mode handles everything
if (isClientSideModel()) {
  voiceMode.setSessionContext(session.id, sdk.directory)
  const success = await voiceMode.sendText(text, { messageID, partID })
  if (!success) { /* handle error */ }
}
```

### Benefits

1. **Single source of truth** - All realtime transcript logic in one file
2. **Bug fix** - User voice input will be captured
3. **Consistency** - Mirrors server-side pattern where prompt endpoint handles everything
4. **Simpler prompt-input** - Component doesn't need to know about transcript storage
5. **Testability** - Easier to test voice-mode.tsx in isolation

### Files to Modify

| File | Changes |
|------|---------|
| `voice-mode.tsx` | Update `sendText()` to store transcript, add user voice listener |
| `prompt-input.tsx` | Remove direct transcript SDK call, simplify to just `voiceMode.sendText()` |

## Session Management Issues

### Current Bug: Global Voice Context

The `VoiceModeProvider` is a global context that persists across OpenCode session switches:

```
┌─────────────────────────────────────────────────────────────────────┐
│  Current (Buggy) Behavior                                           │
│                                                                     │
│  OpenCode Session A (voice) ──switch──► OpenCode Session B (voice)  │
│           │                                      │                  │
│           └──── WebRTC connection persists ──────┘                  │
│                 Agent still has Session A context                   │
│                 Transcripts go to Session B                         │
└─────────────────────────────────────────────────────────────────────┘
```

### Correct Behavior

```
┌─────────────────────────────────────────────────────────────────────┐
│  Voice Session → Regular Session                                    │
│                                                                     │
│  OpenCode Session A (voice) ──switch──► OpenCode Session B (text)   │
│           │                                      │                  │
│           └──── Disconnect WebRTC ───────────────┘                  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  Voice Session → Different Voice Session                            │
│                                                                     │
│  OpenCode Session A (voice) ──switch──► OpenCode Session B (voice)  │
│           │                                      │                  │
│           │  1. Disconnect old WebRTC            │                  │
│           │  2. Connect new WebRTC               │                  │
│           │  3. Inject Session B history         │                  │
│           └──────────────────────────────────────┘                  │
└─────────────────────────────────────────────────────────────────────┘
```

### Implementation Plan

1. ✅ **Conversation context recovery** - DONE
   - Load session history when connecting
   - Inject into realtime session as system context

2. ✅ **Session switching** - DONE
   - Added `createEffect` in `prompt-input.tsx` that watches `params.id` changes
   - On session change: disconnect old WebRTC, wait 100ms, reconnect with new session context
   - New session history is loaded and injected into agent instructions

## Conversation Context Recovery (COMPLETED)

### Problem (Resolved)

When switching to GPT Realtime mid-conversation, the realtime agent doesn't have access to previous conversation history from the OpenCode session.

**Example:**
1. User talks to Claude Opus: "My name is Leo"
2. Claude Opus responds: "Nice to meet you, Leo!"
3. User switches to GPT Realtime model
4. User asks: "What's my name?"
5. GPT Realtime responds: "I don't know your name yet. Could you tell me?"

This happens because:
1. Server-side models (Claude, GPT) receive full conversation history via the prompt endpoint
2. GPT Realtime starts a fresh WebRTC session with no prior context
3. Transcripts are stored for persistence but not injected into the realtime session

### Solution (Implemented)

When connecting to GPT Realtime, load session history and inject it using `session.updateHistory()`:

```typescript
// In voice-mode.tsx connect()
const connect = async () => {
  // ... create session and connect ...
  await session.connect({ apiKey: ephemeralKey })

  // Load conversation history and convert to RealtimeItem[] format
  const conversationHistory = await loadConversationHistory()
  if (conversationHistory && conversationHistory.length > 0) {
    session.updateHistory(conversationHistory)
    console.log("[voice] injected conversation history via updateHistory")
  }

  // ... rest of connect logic ...
}

// loadConversationHistory returns RealtimeItem[] format:
// - User messages: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] }
// - Assistant messages: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }
```

**Key insight:** Use `session.updateHistory()` instead of injecting history into agent instructions. This properly populates the realtime session's conversation history, allowing the model to reference prior messages naturally.

### Alternative Approaches

1. **System prompt injection**: Summarize conversation history into system instructions
2. **Conversation items**: Use OpenAI Realtime API's `conversation.item.create` to add historical messages
3. **Context window**: Only inject most recent N messages to stay within token limits
4. **Lazy loading**: Inject context only when user asks about prior conversation

### Considerations

- Token limits for realtime session instructions
- Latency impact of loading history before connecting
- Whether to include tool calls/results in context
- Privacy: user may not want all history shared with different provider

## Future Considerations

- Real-time streaming of transcripts to UI
- Voice indicator showing when assistant is speaking
- Option to switch between voice and text input mid-conversation
- Conversation context injection when switching to realtime model

## Future Tasks

### Save OpenAI Session Tokens + TTL

**Goal:** Cache ephemeral session tokens to avoid the full connection cycle on every reconnect.

**Problem:**
Currently, every time we connect to GPT Realtime, we:
1. Request a new ephemeral key from the server (`POST /realtime/session`)
2. Server calls OpenAI API to create session and get ephemeral key
3. Client uses ephemeral key to establish WebRTC connection

This adds latency (~1-2 seconds) to every connection, even when reconnecting to the same session within a short time window.

**Solution:**
Cache the ephemeral token on the client with its TTL (time-to-live):

```typescript
interface CachedToken {
  token: string
  expiresAt: number  // Unix timestamp
  sessionID: string  // OpenCode session this token is for
}

// In voice-mode.tsx
let cachedToken: CachedToken | null = null

const getEphemeralKey = async (): Promise<string | null> => {
  const sid = sessionID()

  // Check cache validity
  if (cachedToken &&
      cachedToken.sessionID === sid &&
      cachedToken.expiresAt > Date.now() + 30_000) {  // 30s buffer
    console.log("[voice] using cached ephemeral key")
    return cachedToken.token
  }

  // Fetch new token
  const client = getDirectoryClient() ?? globalSDK.client
  const response = await client.realtime.session()

  if (response.error || !response.data?.value) {
    return null
  }

  // Cache with TTL (OpenAI ephemeral keys typically last 60 seconds)
  cachedToken = {
    token: response.data.value,
    expiresAt: Date.now() + 55_000,  // 55s to be safe
    sessionID: sid,
  }

  return cachedToken.token
}
```

**Benefits:**
- Faster reconnection when toggling voice mode on/off
- Reduced API calls to OpenAI
- Better UX for session switching within TTL window

**Considerations:**
- Need to verify OpenAI ephemeral key TTL (currently assumed ~60 seconds)
- Clear cache when session changes to avoid cross-session issues
- Handle token expiry gracefully (fallback to fetch new token)
