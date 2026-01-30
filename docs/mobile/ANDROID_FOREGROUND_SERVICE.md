# Android Foreground Service Plugin

The `foreground-service` Tauri plugin provides an Android foreground service to keep the WebView alive during background voice sessions.

> **Status: Active.** The plugin is initialized in `lib.rs` and the `startService`/`stopService` commands are called from the frontend when voice mode connects/disconnects. Voice audio is handled entirely by WebRTC inside the WebView (see [VOICE_BACKGROUND_AUDIO.md](./VOICE_BACKGROUND_AUDIO.md)).

## What It Does

When a voice session starts, the frontend invokes `plugin:foreground-service|startService`. This starts an Android foreground service that:

1. Shows a persistent notification ("Voice Session Active")
2. Acquires a `PARTIAL_WAKE_LOCK` (no timeout) to prevent CPU sleep
3. Declares `foregroundServiceType="microphone|mediaPlayback"` so Android treats the process as important

The goal is to prevent Android from suspending the WebView (and killing the WebRTC connection) when the app is backgrounded or the screen is locked.

When voice mode disconnects, `plugin:foreground-service|stopService` stops the service, removes the notification, and releases the wake lock.

## Integration Flow

```
Voice mode connect() [use-realtime-connection.ts]
  |-- WebRTC session established
  |-- setStatus("connected")
  '-- tauriInvoke("plugin:foreground-service|startService")
       '-- Android: ForegroundServicePlugin.startService()
            '-- bindAndStartService()
                 '-- ForegroundService starts foreground
                      |-- Notification shown
                      '-- Wake lock acquired

Voice mode disconnect() / cleanup()
  |-- session.close()
  '-- tauriInvoke("plugin:foreground-service|stopService")
       '-- Android: ForegroundServicePlugin.stopService()
            |-- unbindService()
            '-- stopService()
                 '-- ForegroundService destroyed
                      |-- Notification removed
                      '-- Wake lock released
```

## File Structure

```
plugins/foreground-service/
|-- Cargo.toml                 # Rust crate (tauri-plugin-foreground-service)
|-- build.rs                   # Tauri plugin builder (registers commands)
|-- src/
|   |-- lib.rs                 # Plugin init, Rust API (start/stop service)
|   '-- error.rs               # Error types
|-- ios/                       # iOS stub (no-op, background handled by AVAudioSession)
|   |-- Package.swift
|   '-- Sources/
|       '-- ForegroundServicePlugin.swift
'-- android/                   # Android implementation (Kotlin)
    |-- build.gradle.kts
    |-- settings.gradle
    |-- proguard-rules.pro
    |-- .gitignore             # Excludes build/ and .tauri/
    '-- src/main/
        |-- AndroidManifest.xml
        '-- java/app/tauri/foregroundservice/
            |-- ForegroundServicePlugin.kt  # Main plugin (startService/stopService)
            '-- ForegroundService.kt        # Foreground service + notification + wake lock
```

## Commands

| Command        | Description                                                      |
| -------------- | ---------------------------------------------------------------- |
| `startService` | Start foreground service (notification + wake lock).             |
| `stopService`  | Stop foreground service, release wake lock, remove notification. |

Frontend usage (from `packages/app/src/hooks/use-realtime-connection.ts`):

```typescript
// Uses __TAURI_INTERNALS__ directly to avoid adding @tauri-apps/api
// as a dependency to the shared app package. No-op on web/desktop.
tauriInvoke("plugin:foreground-service|startService")
tauriInvoke("plugin:foreground-service|stopService")
```

## Plugin Initialization

The plugin is initialized in `packages/desktop/src-tauri/src/lib.rs` for mobile builds only:

```rust
// Mobile-only plugins
#[cfg(mobile)]
{
    builder = builder.plugin(tauri_plugin_foreground_service::init());
}
```

Capability permissions in `packages/desktop/src-tauri/capabilities/default.json`:

```json
"foreground-service:allow-startService",
"foreground-service:allow-stopService"
```

## Android Permissions

Declared in the plugin's `AndroidManifest.xml` and merged into the app manifest:

```xml
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
adb logcat -s ForegroundServicePlugin ForegroundService

# Expected output when voice mode starts:
# D ForegroundServicePlugin: Foreground service starting
# D ForegroundService: ForegroundService created
# D ForegroundService: ForegroundService started
# D ForegroundService: Foreground service started with notification
# D ForegroundService: Wake lock acquired

# Expected output when voice mode stops:
# D ForegroundServicePlugin: Foreground service stopped
# D ForegroundService: ForegroundService destroyed
# D ForegroundService: Wake lock released
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

Start a voice session on the phone. If the foreground service starts, you'll see a persistent notification "Voice Session Active" in the notification shade. That confirms the full chain (JS -> Tauri invoke -> Kotlin plugin -> foreground service) is working.

### Verifying background behavior

1. Start a voice session (notification should appear)
2. Press the home button or lock the screen
3. Check if the voice conversation continues (AI should still respond)
4. Return to the app -- check if the session is still connected

## Android Version Compatibility

| Android Version | API Level | Notes                                                                         |
| --------------- | --------- | ----------------------------------------------------------------------------- |
| Android 8+      | 26+       | Requires `startForegroundService()`                                           |
| Android 10+     | 29+       | Requires `foregroundServiceType` in `startForeground()`                       |
| Android 13+     | 33+       | Requires `POST_NOTIFICATIONS` runtime permission                              |
| Android 14+     | 34+       | Must declare `foregroundServiceType` in both manifest AND `startForeground()` |

## Known Limitations

1. **WebView may still suspend** -- The foreground service keeps the process alive, but Android WebView may still pause its rendering surface or WebRTC internals when backgrounded. This is uncertain and device-dependent.

2. **OEM battery optimization** -- Samsung, Xiaomi, Huawei have aggressive battery killers that may terminate foreground services despite proper implementation. Users may need to whitelist the app in battery settings.

3. **No audio focus handling** -- Phone calls and other audio apps will interfere with the WebRTC session. No automatic pause/resume on interruption.

## Key Files

| File                                                                | Purpose                                               |
| ------------------------------------------------------------------- | ----------------------------------------------------- |
| `packages/app/src/hooks/use-realtime-connection.ts`                 | Frontend: calls startService/stopService              |
| `packages/desktop/src-tauri/src/lib.rs`                             | Plugin initialization (`#[cfg(mobile)]`)              |
| `packages/desktop/src-tauri/capabilities/default.json`              | Permission grants for startService/stopService        |
| `plugins/foreground-service/src/lib.rs`                             | Rust plugin API                                       |
| `plugins/foreground-service/android/.../ForegroundServicePlugin.kt` | Kotlin: startService/stopService commands             |
| `plugins/foreground-service/android/.../ForegroundService.kt`       | Kotlin: foreground service + notification + wake lock |

## References

- [VOICE_BACKGROUND_AUDIO.md](./VOICE_BACKGROUND_AUDIO.md) -- Background audio architecture and alternative approaches
- [Tauri Plugin Development](https://v2.tauri.app/develop/plugins/)
- [Android Foreground Services](https://developer.android.com/develop/background-work/services/foreground-services)
