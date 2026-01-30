# Android Audio Bridge Plugin

The `audio-bridge` Tauri plugin provides an Android foreground service used to keep the WebView alive during background voice sessions.

> **Status: Active (foreground service only).** The plugin is initialized in `lib.rs` and the `startService`/`stopService` commands are called from the frontend when voice mode connects/disconnects. The native audio capture (`AudioRecorder`) and playback (`AudioPlayer`) code exists but is **dead code** -- not called by any active code path. Voice audio is handled entirely by WebRTC inside the WebView (see [VOICE_BACKGROUND_AUDIO.md](./VOICE_BACKGROUND_AUDIO.md)).

## What It Does

When a voice session starts, the frontend invokes `plugin:audio-bridge|startService`. This starts an Android foreground service that:

1. Shows a persistent notification ("Voice Recording Active")
2. Acquires a `PARTIAL_WAKE_LOCK` to prevent CPU sleep
3. Declares `foregroundServiceType="microphone|mediaPlayback"` so Android treats the process as important

The goal is to prevent Android from suspending the WebView (and killing the WebRTC connection) when the app is backgrounded or the screen is locked.

When voice mode disconnects, `plugin:audio-bridge|stopService` stops the service, removes the notification, and releases the wake lock.

## Integration Flow

```
Voice mode connect() [use-realtime-connection.ts]
  |-- WebRTC session established
  |-- setStatus("connected")
  '-- tauriInvoke("plugin:audio-bridge|startService")
       '-- Android: AudioBridgePlugin.startService()
            '-- bindAndStartService()
                 '-- AudioCaptureService starts foreground
                      |-- Notification shown
                      '-- Wake lock acquired

Voice mode disconnect() / cleanup()
  |-- session.close()
  '-- tauriInvoke("plugin:audio-bridge|stopService")
       '-- Android: AudioBridgePlugin.stopService()
            |-- unbindService()
            '-- stopService()
                 '-- AudioCaptureService destroyed
                      |-- Notification removed
                      '-- Wake lock released
```

## File Structure

```
plugins/audio-bridge/
|-- Cargo.toml                 # Rust dependencies (iOS + Android)
|-- build.rs                   # Tauri plugin builder (registers commands)
|-- src/
|   |-- lib.rs                 # Plugin init, Rust API (start/stop service)
|   |-- error.rs               # Error types
|   '-- models.rs              # Shared data models
|-- ios/                       # iOS implementation (Swift, not active)
|   '-- Sources/
|       '-- AudioBridgePlugin.swift
'-- android/                   # Android implementation (Kotlin)
    |-- build.gradle.kts
    |-- settings.gradle
    |-- proguard-rules.pro
    '-- src/main/
        |-- AndroidManifest.xml
        '-- java/app/tauri/audiobridge/
            |-- AudioBridgePlugin.kt    # Main plugin (startService/stopService)
            |-- AudioCaptureService.kt  # Foreground service + notification + wake lock
            |-- AudioRecorder.kt        # DEAD CODE - native mic capture
            '-- AudioPlayer.kt          # DEAD CODE - native audio playback
```

## Commands

### Active Commands

| Command | Description |
|---------|-------------|
| `startService` | Start foreground service (notification + wake lock). No audio capture. |
| `stopService` | Stop foreground service, release wake lock, remove notification. |

Frontend usage (from `packages/app/src/hooks/use-realtime-connection.ts`):

```typescript
// Uses __TAURI_INTERNALS__ directly to avoid adding @tauri-apps/api
// as a dependency to the shared app package. No-op on web/desktop.
tauriInvoke("plugin:audio-bridge|startService")
tauriInvoke("plugin:audio-bridge|stopService")
```

### Dead Code Commands

These commands exist in the plugin but are **not called** from any frontend code:

| Command | Description |
|---------|-------------|
| `startCapture` | Start native mic recording via AudioRecorder (would conflict with WebRTC) |
| `stopCapture` | Stop native mic recording |
| `playAudio` | Play PCM16 audio via AudioTrack |
| `checkPermissions` | Check mic permission status |
| `requestPermissions` | Request mic permission |

These may become useful if the architecture changes to a server-side relay approach (see [VOICE_BACKGROUND_AUDIO.md](./VOICE_BACKGROUND_AUDIO.md), Approach 3).

## Plugin Initialization

The plugin is initialized in `packages/desktop/src-tauri/src/lib.rs` for mobile builds only:

```rust
// Mobile-only plugins
#[cfg(mobile)]
{
    builder = builder.plugin(tauri_plugin_audio_bridge::init());
}
```

Capability permissions in `packages/desktop/src-tauri/capabilities/default.json`:

```json
"audio-bridge:allow-startService",
"audio-bridge:allow-stopService"
```

## Android Permissions

Declared in the plugin's `AndroidManifest.xml` and merged into the app manifest:

```xml
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MICROPHONE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />
<uses-permission android:name="android.permission.WAKE_LOCK" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

## Debugging

### adb logcat (native Kotlin logs)

The Kotlin code uses `Log.d()` with specific tags. Filter for them:

```bash
# Watch audio-bridge plugin logs
adb logcat -s AudioBridgePlugin AudioCaptureService

# Expected output when voice mode starts:
# D AudioBridgePlugin: Foreground service starting
# D AudioCaptureService: AudioCaptureService created
# D AudioCaptureService: AudioCaptureService started
# D AudioCaptureService: Foreground service started with notification
# D AudioCaptureService: Wake lock acquired

# Expected output when voice mode stops:
# D AudioBridgePlugin: Foreground service stopped
# D AudioCaptureService: AudioCaptureService destroyed
# D AudioCaptureService: Wake lock released
```

### Chrome DevTools (JS console logs)

Inspect the WebView's JavaScript console via Chrome:

1. Connect phone via USB with USB debugging enabled
2. Open `chrome://inspect` in Chrome on your computer
3. The Tauri WebView should appear as an inspectable target
4. Look for `[realtime]` prefixed logs:

```
[realtime] foreground service started        # startService succeeded
[realtime] foreground service not available:  # plugin not registered (desktop/web)
[realtime] foreground service stopped         # stopService succeeded
```

### Quick smoke test

Start a voice session on the phone. If the foreground service starts, you'll see a persistent notification "Voice Recording Active" in the notification shade. That confirms the full chain (JS -> Tauri invoke -> Kotlin plugin -> foreground service) is working.

### Verifying background behavior

1. Start a voice session (notification should appear)
2. Press the home button or lock the screen
3. Check if the voice conversation continues (AI should still respond)
4. Return to the app -- check if the session is still connected

## Android Version Compatibility

| Android Version | API Level | Notes |
|-----------------|-----------|-------|
| Android 8+ | 26+ | Requires `startForegroundService()` |
| Android 10+ | 29+ | Requires `foregroundServiceType` in `startForeground()` |
| Android 13+ | 33+ | Requires `POST_NOTIFICATIONS` runtime permission |
| Android 14+ | 34+ | Must declare `foregroundServiceType` in both manifest AND `startForeground()` |

## Known Limitations

1. **WebView may still suspend** -- The foreground service keeps the process alive, but Android WebView may still pause its rendering surface or WebRTC internals when backgrounded. This is uncertain and device-dependent.

2. **OEM battery optimization** -- Samsung, Xiaomi, Huawei have aggressive battery killers that may terminate foreground services despite proper implementation. Users may need to whitelist the app in battery settings.

3. **Wake lock timeout** -- The wake lock is acquired with a 10-minute timeout. Long voice sessions may need the lock re-acquired.

4. **No audio focus handling** -- Phone calls and other audio apps will interfere with the WebRTC session. No automatic pause/resume on interruption.

## Key Files

| File | Purpose |
|------|---------|
| `packages/app/src/hooks/use-realtime-connection.ts` | Frontend: calls startService/stopService |
| `packages/desktop/src-tauri/src/lib.rs` | Plugin initialization (`#[cfg(mobile)]`) |
| `packages/desktop/src-tauri/capabilities/default.json` | Permission grants for startService/stopService |
| `plugins/audio-bridge/src/lib.rs` | Rust plugin API |
| `plugins/audio-bridge/android/.../AudioBridgePlugin.kt` | Kotlin: startService/stopService commands |
| `plugins/audio-bridge/android/.../AudioCaptureService.kt` | Kotlin: foreground service + notification + wake lock |

## References

- [VOICE_BACKGROUND_AUDIO.md](./VOICE_BACKGROUND_AUDIO.md) -- Background audio architecture and alternative approaches
- [Tauri Plugin Development](https://v2.tauri.app/develop/plugins/)
- [Android Foreground Services](https://developer.android.com/develop/background-work/services/foreground-services)
