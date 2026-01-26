# Phase 3: Client-Side Model Integration

**Status: IN PROGRESS**

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

## Future Considerations

- Real-time streaming of transcripts to UI
- Voice indicator showing when assistant is speaking
- Option to switch between voice and text input mid-conversation
