# Voice & Background Audio Research

This document covers the research and implementation strategies for hands-free voice interaction with background audio support, similar to ChatGPT Voice.

## Goal

Enable a **hands-free voice experience** where users can:
1. Start a voice session with the OpenCode agent
2. Lock their phone or switch apps while the conversation continues
3. Receive audio responses through speakers/headphones
4. Provide voice input even when the app is backgrounded
5. See lock screen controls (pause, end session)

This is the **stretch goal** functionality due to significant platform complexity.

## Reference: ChatGPT Voice Mode

ChatGPT's voice mode achieves this by:
1. Using VoIP-style audio sessions (priority audio routing)
2. Running as a "call" from the OS perspective
3. Displaying on lock screen with call controls
4. Keeping microphone active in background
5. Using push-to-talk or voice activity detection

## Platform-Specific Analysis

### iOS

#### Audio Session Categories

iOS provides `AVAudioSession` categories that determine audio behavior:

| Category | Background Audio | Mic in Background | Use Case |
|----------|-----------------|-------------------|----------|
| `.playback` | Yes | No | Music apps |
| `.record` | No | Yes | Voice memos |
| `.playAndRecord` | Yes | Yes | VoIP, voice chat |
| `.voiceChat` | Yes | Yes | Real-time voice |

**Recommended**: `.playAndRecord` with `.voiceChat` mode

```swift
let session = AVAudioSession.sharedInstance()
try session.setCategory(
    .playAndRecord,
    mode: .voiceChat,
    options: [.allowBluetooth, .defaultToSpeaker, .mixWithOthers]
)
try session.setActive(true)
```

#### Background Modes Required

In `Info.plist`:
```xml
<key>UIBackgroundModes</key>
<array>
    <string>audio</string>      <!-- Background audio playback -->
    <string>voip</string>       <!-- VoIP for push-to-talk -->
</array>
```

#### CallKit Integration (Phone-Call-Like Experience)

For the most seamless experience, iOS apps can use **CallKit** to present voice sessions as calls:

```swift
import CallKit

let provider = CXProvider(configuration: CXProviderConfiguration())
provider.setDelegate(self, queue: nil)

// Start a "call" (voice session)
let update = CXCallUpdate()
update.remoteHandle = CXHandle(type: .generic, value: "OpenCode Agent")
update.hasVideo = false
update.supportsDTMF = false
update.supportsHolding = true

provider.reportNewIncomingCall(with: uuid, update: update) { error in
    // Handle error
}
```

**CallKit Benefits:**
- Lock screen call UI
- Native call controls (mute, speaker, end)
- Audio interruption handling
- CarPlay integration
- "Do Not Disturb" bypass (optional)

**CallKit Limitations:**
- App Store review scrutiny (must be legitimate VoIP use)
- Cannot be used purely for AI conversations (gray area)
- Requires real-time bidirectional audio

#### Alternative: Now Playing + Remote Commands

For a less intrusive approach, use **MPNowPlayingInfoCenter**:

```swift
import MediaPlayer

// Set now playing info
let nowPlayingInfo: [String: Any] = [
    MPMediaItemPropertyTitle: "OpenCode Voice Session",
    MPMediaItemPropertyArtist: "Talking to Agent",
    MPNowPlayingInfoPropertyPlaybackRate: 1.0
]
MPNowPlayingInfoCenter.default().nowPlayingInfo = nowPlayingInfo

// Handle remote commands
let commandCenter = MPRemoteCommandCenter.shared()
commandCenter.pauseCommand.addTarget { event in
    // Pause voice session
    return .success
}
commandCenter.playCommand.addTarget { event in
    // Resume voice session
    return .success
}
```

This provides:
- Lock screen controls
- Control Center widget
- Headphone button handling
- No App Store concerns

#### iOS Background Execution Limits

- **Background audio**: Unlimited while audio is playing
- **VoIP**: Unlimited with active call
- **Background fetch**: ~30 seconds, unreliable timing
- **Background processing**: Limited to specific tasks

**Key Insight**: As long as audio is actively playing/recording, iOS keeps the app alive.

### Android

#### Audio Focus

Android uses an audio focus system to manage audio between apps:

```kotlin
val audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager

val focusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
    .setAudioAttributes(
        AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()
    )
    .setAcceptsDelayedFocusGain(true)
    .setOnAudioFocusChangeListener { focusChange ->
        when (focusChange) {
            AudioManager.AUDIOFOCUS_LOSS -> pauseVoiceSession()
            AudioManager.AUDIOFOCUS_GAIN -> resumeVoiceSession()
        }
    }
    .build()

audioManager.requestAudioFocus(focusRequest)
```

#### Foreground Service (Required for Background)

Android **requires** a foreground service for background audio:

```kotlin
class VoiceSessionService : Service() {

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("OpenCode Voice Session")
            .setContentText("Talking to agent...")
            .setSmallIcon(R.drawable.ic_voice)
            .addAction(R.drawable.ic_mute, "Mute", mutePendingIntent)
            .addAction(R.drawable.ic_end, "End", endPendingIntent)
            .setOngoing(true)
            .build()

        startForeground(NOTIFICATION_ID, notification,
            ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE or
            ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)

        return START_STICKY
    }
}
```

#### Manifest Permissions

```xml
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MICROPHONE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />
<uses-permission android:name="android.permission.WAKE_LOCK" />

<service
    android:name=".VoiceSessionService"
    android:foregroundServiceType="microphone|mediaPlayback"
    android:exported="false" />
```

#### ConnectionService (Phone-Call-Like Experience)

Android's equivalent to CallKit is **ConnectionService**:

```kotlin
class VoiceConnectionService : ConnectionService() {

    override fun onCreateOutgoingConnection(
        connectionManagerPhoneAccount: PhoneAccountHandle,
        request: ConnectionRequest
    ): Connection {
        return VoiceConnection().apply {
            setInitializing()
            setActive()
        }
    }
}

class VoiceConnection : Connection() {
    override fun onDisconnect() {
        // End voice session
        setDisconnected(DisconnectCause(DisconnectCause.LOCAL))
        destroy()
    }

    override fun onHold() {
        // Pause voice session
        setOnHold()
    }

    override fun onUnhold() {
        // Resume voice session
        setActive()
    }
}
```

**ConnectionService Benefits:**
- Native dialer integration
- Lock screen call UI
- Bluetooth headset button support
- Car Bluetooth integration

**ConnectionService Limitations:**
- Complex setup with PhoneAccount registration
- May require CALL_PHONE permission (user concern)
- Play Store policy considerations

## Implementation Strategies

### Strategy 1: Simple Background Audio (Recommended Start)

**Complexity**: Low
**Coverage**: 70% of use case

1. Use `.playAndRecord` audio session (iOS) / foreground service (Android)
2. Keep audio playing/recording to maintain background execution
3. Use Now Playing / Media Notification for lock screen controls
4. No "call" UI, but functional background voice

**Pros:**
- Simpler implementation
- No App Store policy concerns
- Works in Tauri with plugins

**Cons:**
- No native call UI
- May be interrupted by real calls
- Less seamless UX

### Strategy 2: VoIP/Call Integration (Stretch Goal)

**Complexity**: High
**Coverage**: 95% of use case

1. Use CallKit (iOS) / ConnectionService (Android)
2. Present voice session as a "call"
3. Full lock screen integration
4. Native call controls

**Pros:**
- Best possible UX
- True hands-free experience
- Professional feel

**Cons:**
- Platform-specific native code required
- App Store review scrutiny
- May need to justify as "VoIP" use

### Strategy 3: Hybrid Approach

1. Start with Strategy 1 for MVP
2. Add call integration later for power users
3. Make it opt-in ("Call Mode" toggle)

## Tauri Integration

### Option A: Web APIs (Limited)

The Web Audio API and MediaRecorder work in WebView, but:
- No background execution
- No lock screen integration
- App must be in foreground

### Option B: Tauri Plugin (Recommended)

Create a custom Tauri plugin for voice handling:

```rust
// src-tauri/src/voice_plugin.rs
use tauri::{plugin::Plugin, Runtime};

pub struct VoicePlugin<R: Runtime> {
    // Platform-specific voice session handle
}

impl<R: Runtime> Plugin<R> for VoicePlugin<R> {
    fn name(&self) -> &'static str {
        "voice"
    }
}

#[tauri::command]
async fn start_voice_session() -> Result<(), String> {
    // Platform-specific implementation
    #[cfg(target_os = "ios")]
    ios::start_audio_session()?;

    #[cfg(target_os = "android")]
    android::start_foreground_service()?;

    Ok(())
}

#[tauri::command]
async fn stop_voice_session() -> Result<(), String> {
    // Stop audio session
}
```

### Option C: Native Swift/Kotlin Modules

For CallKit/ConnectionService integration, write native modules:

```
packages/mobile/
├── src-tauri/
│   ├── gen/
│   │   ├── apple/
│   │   │   └── Sources/
│   │   │       └── VoiceSession.swift  # CallKit integration
│   │   └── android/
│   │       └── app/src/main/kotlin/
│   │           └── VoiceSessionService.kt  # ConnectionService
```

## Audio Streaming Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Mobile Client                           │
│                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    │
│  │   Voice     │───▶│   WebSocket │───▶│   Audio     │    │
│  │   Capture   │    │   Client    │◀───│   Playback  │    │
│  └─────────────┘    └─────────────┘    └─────────────┘    │
│        │                   │                  │            │
│        │                   │                  │            │
│        ▼                   │                  ▼            │
│  ┌─────────────┐           │           ┌─────────────┐    │
│  │ Audio Chunk │           │           │ Audio Chunk │    │
│  │  Encoding   │           │           │  Decoding   │    │
│  │  (Opus)     │           │           │  (Opus)     │    │
│  └─────────────┘           │           └─────────────┘    │
└────────────────────────────┼────────────────────────────────┘
                             │
                             │ WebSocket
                             │ Binary frames (audio)
                             │ JSON frames (control)
                             │
┌────────────────────────────┼────────────────────────────────┐
│                            ▼                                │
│                   OpenCode Server                           │
│                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    │
│  │   Speech    │───▶│   Agent     │───▶│   Text to   │    │
│  │   to Text   │    │   Logic     │    │   Speech    │    │
│  └─────────────┘    └─────────────┘    └─────────────┘    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Voice Activity Detection (VAD)

For hands-free operation, implement VAD to detect when the user is speaking:

### Client-Side VAD (Recommended)

```typescript
// Using @ricky0123/vad-web or similar
import { MicVAD } from "@ricky0123/vad-web"

const vad = await MicVAD.new({
  onSpeechStart: () => {
    // User started speaking
    startAudioCapture()
  },
  onSpeechEnd: (audio) => {
    // User stopped speaking
    sendAudioToServer(audio)
  },
  positiveSpeechThreshold: 0.8,
  negativeSpeechThreshold: 0.3,
})
```

### Server-Side VAD

Alternatively, stream all audio to server and let it handle VAD:
- Higher bandwidth usage
- Lower latency for response
- More accurate with better models

## Latency Considerations

For a conversational experience, target these latencies:

| Stage | Target | Notes |
|-------|--------|-------|
| Voice capture → Server | < 100ms | Use WebSocket, small chunks |
| Speech-to-Text | < 500ms | Use streaming STT |
| Agent processing | Variable | Depends on model |
| Text-to-Speech | < 200ms | Use streaming TTS |
| Audio playback start | < 50ms | Pre-buffer audio |
| **Total round-trip** | < 1-2s | For natural conversation |

## Recommended Implementation Order

1. **MVP (No Background)**
   - Voice capture in foreground
   - Text-to-speech playback
   - WebSocket streaming to server
   - Works in basic Tauri WebView

2. **Background Audio (Strategy 1)**
   - iOS: AVAudioSession with playAndRecord
   - Android: Foreground service
   - Now Playing / Media notification
   - Lock screen controls

3. **Call Integration (Strategy 2 - Stretch)**
   - iOS: CallKit integration
   - Android: ConnectionService
   - Full native call UI
   - Bluetooth headset support

## References

### iOS
- [AVAudioSession Programming Guide](https://developer.apple.com/library/archive/documentation/Audio/Conceptual/AudioSessionProgrammingGuide/)
- [CallKit Documentation](https://developer.apple.com/documentation/callkit)
- [Background Execution](https://developer.apple.com/documentation/uikit/app_and_environment/scenes/preparing_your_ui_to_run_in_the_background)

### Android
- [Audio Focus](https://developer.android.com/guide/topics/media-apps/audio-focus)
- [Foreground Services](https://developer.android.com/guide/components/foreground-services)
- [ConnectionService](https://developer.android.com/reference/android/telecom/ConnectionService)

### Voice AI
- [OpenAI Realtime API](https://platform.openai.com/docs/guides/realtime)
- [WebRTC for Voice](https://webrtc.org/)
- [Opus Audio Codec](https://opus-codec.org/)
