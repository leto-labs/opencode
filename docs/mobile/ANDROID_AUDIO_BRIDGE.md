# Android Audio Bridge Implementation

This document describes the Android implementation of the `audio-bridge` Tauri plugin for background voice input/output.

## Overview

The audio-bridge plugin provides native audio capture and playback capabilities for Android, enabling:
- Background microphone recording via Foreground Service
- PCM16 audio capture at 16kHz (configurable)
- Audio playback via AudioTrack
- Proper Android permission handling

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Frontend (TypeScript)                    │
├─────────────────────────────────────────────────────────────┤
│                        Tauri Bridge                          │
├─────────────────────────────────────────────────────────────┤
│                    Rust Plugin Layer                         │
│              (lib.rs - platform registration)                │
├─────────────────────────────────────────────────────────────┤
│                   Kotlin Implementation                      │
│  ┌─────────────────────┐  ┌─────────────────────────────┐  │
│  │  AudioBridgePlugin  │──│    AudioCaptureService      │  │
│  │  (main entry point) │  │  (Foreground Service)       │  │
│  └─────────────────────┘  └─────────────────────────────┘  │
│           │                           │                      │
│           ▼                           ▼                      │
│  ┌─────────────────┐         ┌─────────────────┐           │
│  │   AudioPlayer   │         │  AudioRecorder  │           │
│  │  (AudioTrack)   │         │  (AudioRecord)  │           │
│  └─────────────────┘         └─────────────────┘           │
└─────────────────────────────────────────────────────────────┘
```

## File Structure

```
plugins/audio-bridge/
├── Cargo.toml                 # Rust dependencies (iOS + Android)
├── build.rs                   # Tauri plugin builder
├── src/
│   ├── lib.rs                 # Plugin registration (iOS + Android)
│   ├── error.rs               # Error types
│   └── models.rs              # Shared data models
├── ios/                       # iOS implementation (Swift)
│   └── Sources/
│       └── AudioBridgePlugin.swift
└── android/                   # Android implementation (Kotlin)
    ├── build.gradle.kts       # Gradle build config
    ├── settings.gradle
    ├── proguard-rules.pro
    └── src/main/
        ├── AndroidManifest.xml
        └── java/app/tauri/audiobridge/
            ├── AudioBridgePlugin.kt    # Main plugin
            ├── AudioCaptureService.kt  # Foreground service
            ├── AudioRecorder.kt        # AudioRecord wrapper
            └── AudioPlayer.kt          # AudioTrack wrapper
```

## API Contract

### Commands

| Command | Input | Output |
|---------|-------|--------|
| `checkPermissions` | - | `{ microphone: "granted" \| "denied" \| "prompt" }` |
| `requestPermissions` | - | `{ microphone: "granted" \| "denied" \| "prompt" }` |
| `startCapture` | `{ sampleRate?: 16000, channels?: 1 }` | - |
| `stopCapture` | - | - |
| `playAudio` | `{ data: number[], sampleRate: 16000, channels: 1 }` | - |

### Events

| Event | Payload |
|-------|---------|
| `audioData` | `{ data: number[], sampleRate: number, channels: number }` |
| `playbackFinished` | `{}` |

### Critical: Event Listener Registration

**The frontend MUST register event listeners BEFORE calling `startCapture`.**

The `trigger()` method only sends events to registered listeners. If no listener is registered, events are silently dropped.

```typescript
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

// 1. Register listener FIRST
const unlisten = await listen('plugin:audio-bridge:audioData', (event) => {
  const { data, sampleRate, channels } = event.payload;
  // Process PCM16 audio data
});

// 2. THEN start capture
await invoke('plugin:audio-bridge|startCapture', { sampleRate: 16000, channels: 1 });

// 3. When done, stop and unregister
await invoke('plugin:audio-bridge|stopCapture');
unlisten();
```

## Android-Specific Implementation Details

### Foreground Service Requirement

Android kills background audio processes without a Foreground Service. The `AudioCaptureService` class:
- Starts as a foreground service with a persistent notification
- Declares `foregroundServiceType="microphone|mediaPlayback"` for Android 14+
- Uses a WakeLock to prevent CPU sleep during recording

### Permissions

The plugin declares these permissions in `AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MICROPHONE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />
<uses-permission android:name="android.permission.WAKE_LOCK" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

The main app's `AndroidManifest.xml` must also include foreground service permissions.

### Audio Configuration

**Recording (AudioRecorder.kt):**
- Source: `MediaRecorder.AudioSource.MIC`
- Format: `AudioFormat.ENCODING_PCM_16BIT`
- Default: 16kHz, mono
- Buffer: 4096 samples per callback

**Playback (AudioPlayer.kt):**
- Mode: `AudioTrack.MODE_STREAM`
- Usage: `AudioAttributes.USAGE_VOICE_COMMUNICATION`
- Content Type: `AudioAttributes.CONTENT_TYPE_SPEECH`

### Android Version Compatibility

| Android Version | API Level | Notes |
|-----------------|-----------|-------|
| Android 8+ | 26+ | Requires `startForegroundService()` |
| Android 10+ | 29+ | Requires `foregroundServiceType` in `startForeground()` |
| Android 13+ | 33+ | Requires `POST_NOTIFICATIONS` permission |
| Android 14+ | 34+ | Must declare `foregroundServiceType` in both manifest AND `startForeground()` |

### Plugin Lifecycle

The plugin implements `onDestroy()` to properly clean up resources when the activity is destroyed:
- Unbinds from the foreground service
- Stops the foreground service
- Releases the audio player

This ensures no resource leaks when the app is closed.

## Known Limitations

1. **OEM Battery Optimization**
   - Samsung, Xiaomi, Huawei have aggressive battery killers
   - May terminate foreground service despite proper implementation
   - Users may need to manually whitelist the app in battery settings

2. **Audio Focus Not Implemented**
   - Phone calls and other audio apps will interfere
   - No automatic pause/resume on interruption
   - Future enhancement: implement `AudioFocusRequest` handling

3. **Large JSON Payloads**
   - 4096 samples at 16kHz = ~8KB JSON every ~256ms
   - May cause performance issues on slower devices
   - Consider base64 encoding or binary transfer for optimization

4. **No Bluetooth Audio Routing**
   - Audio session not configured for Bluetooth
   - May not work with Bluetooth headsets for recording

## Rust Integration

### Cargo.toml

```toml
[package.metadata.platforms.support]
android = { level = "full", notes = "" }
ios = { level = "full", notes = "" }

[build-dependencies]
tauri-plugin = { version = "2", features = ["build"] }

[target.'cfg(target_os = "android")'.dependencies]
tauri = { version = "2", features = ["wry"] }
```

### build.rs

```rust
const COMMANDS: &[&str] = &[
    "startCapture",
    "stopCapture",
    "playAudio",
    "checkPermissions",
    "requestPermissions",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .try_build();
}
```

### lib.rs

```rust
#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "app.tauri.audiobridge";

// In setup:
#[cfg(target_os = "android")]
let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "AudioBridgePlugin")?;
```

## Common Issues & Solutions

### 1. `From<PluginInvokeError>` not implemented

The `run_mobile_plugin` method returns `PluginInvokeError`. Add this to `error.rs`:

```rust
#[error("Plugin invoke error: {0}")]
PluginInvoke(String),

impl From<tauri::plugin::mobile::PluginInvokeError> for Error {
    fn from(err: tauri::plugin::mobile::PluginInvokeError) -> Self {
        Error::PluginInvoke(err.to_string())
    }
}
```

### 2. Kotlin `if` expression without else branch

In Kotlin, when an `if` statement is the last expression in a lambda (like `.let {}`), it must have an else branch. Fix by adding `Unit` at the end:

```kotlin
someValue?.let { value ->
    if (condition) {
        doSomething()
    }
    Unit  // Explicit return type
}
```

### 3. Service killed in background

Ensure:
- Foreground service is started before binding
- WakeLock is acquired during recording
- Notification channel is created (required for Android 8+)

### 4. Plugin lifecycle methods

The Tauri `Plugin` base class provides these lifecycle methods to override:
- `load(webView: WebView)` - Called when plugin loads
- `onDestroy()` - Called when activity is destroyed
- `onPause()` / `onResume()` - Activity lifecycle
- `onNewIntent(intent: Intent)` - New intent received

**Note:** There is no `handleOnDestroy()` method - use `onDestroy()` instead.

### 5. Events not received by frontend

If `audioData` events are not reaching the frontend:
1. Ensure listener is registered BEFORE calling `startCapture`
2. Use correct event name: `plugin:audio-bridge:audioData`
3. Check that `trigger()` is being called (add logging)

## Testing

### Build Verification

```bash
cd packages/desktop
bun tauri android build --debug
```

### Manual Testing Checklist

1. **Permission Flow:**
   - Fresh install shows permission dialog
   - Grant permission enables capture
   - Deny permission returns error

2. **Background Recording:**
   - Start capture shows notification
   - Recording continues when app is in background
   - Recording continues when screen is locked
   - Stop capture removes notification

3. **Audio Quality:**
   - `audioData` events contain valid PCM16 samples
   - Sample rate matches configuration (16kHz default)
   - Play recorded data back to verify quality

### Device Matrix

Test on:
- Android 14 (API 34) - Pixel emulator
- Android 12 (API 31) - Pixel emulator
- Physical device - Android 13+

## Implementation Status

### Verified
- [x] APK builds successfully
- [x] Manifest merging includes permissions and service
- [x] Plugin registration follows official patterns
- [x] Permission handling uses Tauri's built-in system

### Needs Device Testing
- [ ] Foreground service starts correctly
- [ ] Audio recording captures valid PCM16 data
- [ ] Events reach frontend via `trigger()`
- [ ] Background recording continues with screen off
- [ ] `onDestroy()` cleanup works properly
- [ ] Audio playback via `playAudio` command

### Not Implemented
- [ ] Audio focus handling (pause on phone calls)
- [ ] Bluetooth audio routing
- [ ] Binary/base64 audio transfer (performance optimization)

## References

- [Tauri Plugin Development](https://v2.tauri.app/develop/plugins/)
- [Android Foreground Services](https://developer.android.com/develop/background-work/services/foreground-services)
- [AudioRecord API](https://developer.android.com/reference/android/media/AudioRecord)
- [AudioTrack API](https://developer.android.com/reference/android/media/AudioTrack)
