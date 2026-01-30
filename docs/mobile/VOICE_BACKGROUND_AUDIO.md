# Voice & Background Audio

Status of voice mode on mobile and the challenge of background audio support.

## Current Architecture (What Works)

Voice mode uses the **OpenAI Realtime WebRTC** transport, running entirely inside the WebView:

```
┌─────────────────────────────────────────────────────────────┐
│                     Mobile Client                           │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                  Tauri WebView                        │  │
│  │                                                       │  │
│  │  ┌─────────────┐    ┌──────────────────────────────┐  │  │
│  │  │ voice-mode  │───▶│  @openai/agents/realtime     │  │  │
│  │  │  .tsx       │    │  OpenAIRealtimeWebRTC        │  │  │
│  │  └─────────────┘    └──────────────────────────────┘  │  │
│  │                              │                        │  │
│  │                     WebRTC PeerConnection             │  │
│  │                     (owns audio tracks)               │  │
│  │                              │                        │  │
│  │              ┌───────────────┼───────────────┐        │  │
│  │              ▼               ▼               │        │  │
│  │     getUserMedia()    <audio> element    SDK handles   │  │
│  │     (mic capture)     (playback)        all audio     │  │
│  └───────────────────────────────────────────────────────┘  │
│                              │                              │
│                              │ WebRTC (direct to OpenAI)    │
│                              ▼                              │
│                    OpenAI Realtime API                       │
└─────────────────────────────────────────────────────────────┘
         │
         │ HTTP/WebSocket (ephemeral key, tools, transcripts)
         ▼
┌─────────────────────────────────────────────────────────────┐
│                   OpenCode Backend Server                    │
│              (running on host, port 4096)                    │
└─────────────────────────────────────────────────────────────┘
```

### Key files

| File                                                | Purpose                                                          |
| --------------------------------------------------- | ---------------------------------------------------------------- |
| `packages/app/src/hooks/use-realtime-connection.ts` | WebRTC connection lifecycle, ephemeral key fetch, mic permission |
| `packages/app/src/context/voice-mode.tsx`           | Voice mode state, transcript storage, UI updates                 |
| `packages/app/src/util/openai-realtime-tool.ts`     | Tool definitions for the realtime agent                          |

### Connection flow

1. Frontend calls `sdk.client.session.clientSecret.create()` to get an ephemeral OpenAI key from the backend
2. `navigator.mediaDevices.getUserMedia({ audio: true })` requests mic permission
3. `OpenAIRealtimeWebRTC` creates a WebRTC peer connection directly to OpenAI
4. The SDK manages mic capture, audio playback, VAD, and tool execution internally
5. Transcripts are stored back to the OpenCode backend for history

### What works today

- Foreground voice conversations on both iOS and Android
- Mic input via WebView's `getUserMedia`
- Audio output via `<audio>` element
- Tool execution (glob, grep) during voice sessions
- Transcript persistence to backend

## The Background Audio Problem

When the user locks the phone or switches apps, **Android suspends the WebView**, which kills:

- The WebRTC peer connection (disconnected)
- The `getUserMedia` mic stream (stopped)
- The `<audio>` element playback (paused)

This is by design -- Android aggressively manages background processes to save battery.

## Current Approach: Foreground Service (Approach 1)

The `foreground-service` Tauri plugin (`packages/desktop/src-tauri/plugins/foreground-service/`) implements Approach 1 below. When voice mode connects, the frontend starts an Android foreground service that:

- Shows a persistent notification ("Voice Session Active")
- Acquires a `PARTIAL_WAKE_LOCK` (no timeout) to prevent CPU sleep
- Declares `foregroundServiceType="microphone|mediaPlayback"`

See [ANDROID_FOREGROUND_SERVICE.md](./ANDROID_FOREGROUND_SERVICE.md) for full details.

**Limitations:** The foreground service keeps the process alive, but Android WebView may still pause its rendering surface or WebRTC internals when backgrounded. This is device-dependent.

## Alternative Approaches for Background Audio

### Approach 1: Keep WebView Alive (Current -- Implemented)

Prevent Android from suspending the WebView activity when backgrounded.

**How:**

- Start a foreground service with `FOREGROUND_SERVICE_MICROPHONE | FOREGROUND_SERVICE_MEDIA_PLAYBACK` when voice mode starts
- Acquire a `PARTIAL_WAKE_LOCK` to prevent CPU sleep

**Pros:**

- Minimal code changes
- WebRTC connection stays alive (if Android honors the foreground service)
- No SDK modifications needed

**Cons:**

- Android may still kill the WebView process under memory pressure
- Higher battery usage (WebView stays active)
- Some OEMs (Samsung, Xiaomi) aggressively kill foreground services anyway
- Uncertain whether Android WebView actually preserves WebRTC when backgrounded even with a foreground service

### Approach 2: Native WebRTC (Most Robust, Most Work)

Replace the WebView-based WebRTC with a native Kotlin/Swift WebRTC implementation.

**How:**

- Use Google's [WebRTC Android SDK](https://webrtc.org/native-code/android/) directly in Kotlin
- Create a native `PeerConnection` that connects to OpenAI's Realtime API
- Handle SDP offer/answer, ICE candidates, and audio tracks natively
- Bridge audio events back to the frontend via Tauri plugin events

**Pros:**

- Full control over audio lifecycle
- Survives backgrounding with foreground service
- Best possible audio quality and latency
- Works with lock screen controls

**Cons:**

- Significant implementation effort
- Must reimplement the OpenAI Realtime protocol (SDP exchange, session management)
- Platform-specific code for both iOS and Android
- Must keep in sync with OpenAI API changes

### Approach 3: Server-Side Relay (Architectural Change)

Move the WebRTC connection to the OpenCode backend server, and use a simple audio stream between phone and server.

**How:**

- Backend establishes the WebRTC connection to OpenAI
- Phone streams raw audio to backend via WebSocket
- Backend relays OpenAI audio responses back to phone
- Phone uses native audio APIs for capture/playback

```
Phone --[WebSocket audio]--> Backend --[WebRTC]--> OpenAI
Phone <--[WebSocket audio]-- Backend <--[WebRTC]-- OpenAI
```

**Pros:**

- Phone only needs native audio I/O
- Foreground service keeps native audio alive in background
- Server-side WebRTC is well-supported in Node.js

**Cons:**

- Added latency (phone -> server -> OpenAI)
- Server must be reachable (not just localhost)
- More complex server code
- Double the bandwidth

### Approach 4: Hybrid (Foreground WebRTC + Background Native)

Use WebRTC in the foreground, switch to native audio when backgrounding.

**How:**

- In foreground: normal WebRTC in WebView (current behavior)
- On background: pause WebRTC, start native audio capture via foreground service
- Buffer native audio, reconnect WebRTC when returning to foreground
- Or relay buffered audio to server for processing

**Pros:**

- Best of both worlds
- Graceful degradation

**Cons:**

- Complex state management (switching between two audio systems)
- Interruption in the voice session during transition
- May not provide seamless background conversation

## Recommended Path

1. **Approach 1 is implemented** -- The `foreground-service` plugin starts an Android foreground service with notification and wake lock when voice mode begins. See [ANDROID_FOREGROUND_SERVICE.md](./ANDROID_FOREGROUND_SERVICE.md).

2. **If that proves insufficient, consider Approach 3** -- The server-side relay is the most architecturally sound solution for true background audio.

3. **Approach 2 is a last resort** -- Only if you need pixel-perfect control and are willing to maintain a native WebRTC implementation per platform.

## Platform-Specific Background Audio Details

### Android

**Required for any background audio:**

- Foreground service with persistent notification
- `FOREGROUND_SERVICE_MICROPHONE` and `FOREGROUND_SERVICE_MEDIA_PLAYBACK` permissions
- `WAKE_LOCK` permission and `PARTIAL_WAKE_LOCK` acquisition
- `POST_NOTIFICATIONS` runtime permission (Android 13+)

**Already in place (from d29602a):**

- Manifest permissions declared
- `ForegroundService` class exists (in foreground-service plugin)
- Wake lock implementation exists
- Notification channel and notification builder exist

**Missing:**

- Plugin not initialized in `lib.rs`
- No frontend code to start/stop the foreground service
- No integration between foreground service and WebRTC voice session

### iOS

**Required for background audio:**

- `UIBackgroundModes: audio, voip` in Info.plist
- `AVAudioSession` configured with `.playAndRecord` category
- Active audio playback/recording to maintain background execution

**Not yet implemented for iOS.**

### Lock Screen Controls (Both Platforms)

| Feature              | iOS API                  | Android API          | Status                                                      |
| -------------------- | ------------------------ | -------------------- | ----------------------------------------------------------- |
| Media controls       | `MPNowPlayingInfoCenter` | `MediaSession`       | Not implemented                                             |
| Call-like UI         | `CallKit`                | `ConnectionService`  | Not implemented (stretch)                                   |
| Notification actions | Rich notifications       | Notification actions | Android: partially (foreground service notification exists) |

## References

- [OpenAI Realtime API](https://platform.openai.com/docs/guides/realtime)
- [OpenAI Agents SDK - Realtime](https://github.com/openai/openai-agents-js)
- [Android Foreground Services](https://developer.android.com/develop/background-work/services/foreground-services)
- [iOS Background Execution](https://developer.apple.com/documentation/uikit/app_and_environment/scenes/preparing_your_ui_to_run_in_the_background)
- [WebRTC Android SDK](https://webrtc.org/native-code/android/)
