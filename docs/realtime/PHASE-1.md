# Phase 1: Voice Mode Button

**Status: COMPLETE**

## Goal

Add a microphone button that connects/disconnects to OpenAI Realtime API via WebRTC.

## Tasks

### 1. Add Package

```bash
cd packages/app && bun add @openai/agents
```

Note: Import from `@openai/agents/realtime`

### 2. Create VoiceModeProvider

**File:** `packages/app/src/context/voice-mode.tsx`

- `status: "disconnected" | "connecting" | "connected" | "error"`
- `toggle()` - connect or disconnect
- Uses `RealtimeSession` + `RealtimeAgent` + `OpenAIRealtimeWebRTC`
- Fetches ephemeral key from server `/realtime/session` endpoint (see Task 5)
- Hidden `<audio>` element for playback
- Console.log all events

**Client-side flow:**
```typescript
// 1. Fetch ephemeral key from server
const response = await fetch("/realtime/session");
const data = await response.json();
const ephemeralKey = data.value;

// 2. Connect with ephemeral key
await session.connect({ apiKey: ephemeralKey });
```

### 3. Add Provider to App

**File:** `packages/app/src/app.tsx`

### 4. Add Microphone Button

**File:** `packages/app/src/components/prompt-input.tsx`

- Location: next to attach file button
- Click calls `voiceMode.toggle()`
- Visual state reflects connection status

### 5. Add /realtime/session Server Route

**File:** `packages/opencode/src/server/server.ts`

**Server-side flow:**
```typescript
// 1. Get OpenAI API key from provider config
const provider = await Provider.getProvider("openai");
if (!provider?.key) {
  return c.json({ error: "OpenAI provider not configured" }, { status: 400 });
}

// 2. Request ephemeral client secret from OpenAI
const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${provider.key}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    session: {
      type: "realtime",
      model: "gpt-realtime",
    },
  }),
});

// 3. Return the response (contains value)
const data = await response.json();
return c.json(data);
```

**Response format:**
```json
{
  "value": "ek_..."
}
```

Reference: https://github.com/openai/openai-agents-js/issues/463

## Success Criteria

- [x] Button connects/disconnects WebRTC session
- [x] Server provides ephemeral keys via `/realtime/session` endpoint
- [x] OpenAI API key loaded from provider config (not exposed to client)
- [x] Can speak and hear assistant response
- [x] Events logged to console

## Challenges & Solutions

### 1. API Endpoint Changed

**Problem:** Initial implementation used the deprecated `/v1/realtime/sessions` endpoint which returned a 400 error from the WebRTC `/v1/realtime/calls` endpoint.

**Error:**
```
OperationError: Failed to execute 'setRemoteDescription' on 'RTCPeerConnection':
Failed to parse SessionDescription. { Expect line: v=
```

**Solution:** OpenAI updated their API. The new endpoint is `/v1/realtime/client_secrets` with a different request body format:

| Old Format | New Format |
|------------|------------|
| `POST /v1/realtime/sessions` | `POST /v1/realtime/client_secrets` |
| `{ model: "gpt-4o-realtime-preview-2025-06-03" }` | `{ session: { type: "realtime", model: "gpt-realtime" } }` |
| Response: `client_secret.value` | Response: `value` (top-level) |

**Reference:** [GitHub Issue #463](https://github.com/openai/openai-agents-js/issues/463)

### 2. Route Naming Conflict

**Problem:** Initially named the endpoint `/session` which conflicted with existing `SessionRoutes()` that returns chat session list.

**Solution:** Renamed to `/realtime/session` to avoid conflict.

### 3. Environment Variable Exposure

**Problem:** Early prototype used `VITE_OPENAI_API_KEY` directly in client code, which exposes the API key.

**Solution:** Server-side endpoint fetches ephemeral key using `Provider.getProvider("openai")` to load the key from opencode's provider config. Client only receives short-lived ephemeral tokens.

## Files Changed

| File | Purpose |
|------|---------|
| `packages/opencode/src/server/server.ts` | Added `GET /realtime/session` endpoint that fetches ephemeral keys from OpenAI using the configured provider API key |
| `packages/app/src/context/voice-mode.tsx` | New VoiceModeProvider context managing WebRTC connection state, audio playback, and session lifecycle |
| `packages/app/src/app.tsx` | Wrapped app with VoiceModeProvider |
| `packages/app/src/components/prompt-input.tsx` | Added microphone button that calls `voiceMode.toggle()` |
| `packages/ui/src/components/icon.tsx` | Added `IconMicrophone` component |
| `docs/realtime/README.md` | Added Development section with dev server commands |

## Future Plans

Robustness improvements for later phases:

- **Error handling**: Better error messages and recovery flows when connection fails
- **Graceful disconnect**: Clean up resources properly on disconnect, handle unexpected disconnections
- **Session regeneration**: Automatically regenerate ephemeral key on expiry (2-hour TTL)
- **Session resumption**: Store the realtime session as part of the opencode session to enable reconnection
- **Connection state UI**: Visual feedback for connecting/connected/error states on the microphone button
