# Platform Capabilities Comparison

This document compares iOS and Android capabilities relevant to OpenCode mobile, with focus on voice and background execution.

## Summary Matrix

| Capability | iOS | Android | Notes |
|------------|-----|---------|-------|
| Background Audio Playback | Yes | Yes | Both require configuration |
| Background Mic Recording | Yes (VoIP) | Yes (Service) | Different mechanisms |
| Lock Screen Controls | Yes | Yes | Different APIs |
| Call-Like UI | CallKit | ConnectionService | Similar functionality |
| Voice Activity Detection | Native + Web | Native + Web | Both support |
| WebSocket in Background | With audio | With service | Tied to background mode |
| Push Notifications | APNs | FCM | Different services |
| Bluetooth Audio | AVAudioSession | AudioManager | Both supported |
| CarPlay/Android Auto | CallKit | ConnectionService | Requires call integration |

## iOS Capabilities

### Audio

| Feature | API | Requirements |
|---------|-----|--------------|
| Play audio | AVAudioPlayer / AVPlayer | None |
| Record audio | AVAudioRecorder | NSMicrophoneUsageDescription |
| Background play | AVAudioSession | UIBackgroundModes: audio |
| Background record | AVAudioSession | UIBackgroundModes: voip |
| Voice processing | AVAudioEngine | Voice I/O audio unit |
| Bluetooth routing | AVAudioSession | allowBluetooth option |

### Audio Session Modes

```swift
// For voice conversations
session.setCategory(.playAndRecord, mode: .voiceChat, options: [
    .allowBluetooth,
    .allowBluetoothA2DP,
    .defaultToSpeaker,
    .interruptSpokenAudioAndMixWithOthers
])
```

| Mode | Echo Cancellation | Noise Suppression | Sample Rate |
|------|------------------|-------------------|-------------|
| `.default` | No | No | 44.1kHz |
| `.voiceChat` | Yes | Yes | Optimized |
| `.videoChat` | Yes | Yes | Optimized |
| `.measurement` | No | No | Full |

### Background Modes

| Mode | Purpose | Battery Impact |
|------|---------|---------------|
| `audio` | Music, podcasts | Medium |
| `voip` | VoIP calls | Low (efficient) |
| `fetch` | Periodic updates | Low |
| `processing` | Long tasks | High |
| `location` | GPS tracking | High |

### CallKit

**Capabilities:**
- Incoming/outgoing call UI
- Lock screen integration
- Call directory (caller ID)
- Audio routing management
- Interruption handling
- CarPlay support

**Limitations:**
- Must be "legitimate" VoIP use
- Cannot fake calls for non-voice purposes
- App Store review required

### Entitlements Required

```xml
<!-- Info.plist -->
<key>UIBackgroundModes</key>
<array>
    <string>audio</string>
    <string>voip</string>
</array>

<key>NSMicrophoneUsageDescription</key>
<string>OpenCode needs microphone access for voice conversations</string>

<!-- Optional: For CallKit incoming calls -->
<key>UIBackgroundModes</key>
<array>
    <string>voip</string>
    <string>remote-notification</string>
</array>
```

## Android Capabilities

### Audio

| Feature | API | Requirements |
|---------|-----|--------------|
| Play audio | MediaPlayer / ExoPlayer | None |
| Record audio | MediaRecorder / AudioRecord | RECORD_AUDIO permission |
| Background play | Foreground Service | FOREGROUND_SERVICE_MEDIA_PLAYBACK |
| Background record | Foreground Service | FOREGROUND_SERVICE_MICROPHONE |
| Voice processing | AudioEffect | MODIFY_AUDIO_SETTINGS |
| Bluetooth routing | AudioManager | BLUETOOTH permission |

### Foreground Service Types (Android 14+)

```kotlin
// Required for background audio
startForeground(
    NOTIFICATION_ID,
    notification,
    ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE or
    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
)
```

| Type | Purpose | Manifest Declaration |
|------|---------|---------------------|
| `microphone` | Voice recording | `FOREGROUND_SERVICE_MICROPHONE` |
| `mediaPlayback` | Audio playback | `FOREGROUND_SERVICE_MEDIA_PLAYBACK` |
| `phoneCall` | VoIP calls | `FOREGROUND_SERVICE_PHONE_CALL` |
| `mediaProjection` | Screen capture | `FOREGROUND_SERVICE_MEDIA_PROJECTION` |

### Audio Attributes

```kotlin
val audioAttributes = AudioAttributes.Builder()
    .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
    .build()
```

| Usage | Priority | Ducking Behavior |
|-------|----------|------------------|
| `USAGE_VOICE_COMMUNICATION` | Highest | Others duck |
| `USAGE_MEDIA` | High | Pauses on call |
| `USAGE_ASSISTANT` | High | Ducks music |
| `USAGE_NOTIFICATION` | Medium | Temporary |

### ConnectionService

**Capabilities:**
- Native phone UI integration
- Call log integration
- Bluetooth headset buttons
- Android Auto support
- Multi-call management

**Limitations:**
- Complex PhoneAccount setup
- May show in call history (user confusion)
- Requires CALL permission on some OEMs
- Play Store policy considerations

### Permissions Required

```xml
<!-- AndroidManifest.xml -->

<!-- Core permissions -->
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />

<!-- Background execution -->
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MICROPHONE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />
<uses-permission android:name="android.permission.WAKE_LOCK" />

<!-- Optional: ConnectionService -->
<uses-permission android:name="android.permission.MANAGE_OWN_CALLS" />
<uses-permission android:name="android.permission.READ_PHONE_STATE" />

<!-- Service declaration -->
<service
    android:name=".VoiceService"
    android:foregroundServiceType="microphone|mediaPlayback"
    android:exported="false" />
```

## Cross-Platform Comparison

### Voice Capture

| Aspect | iOS | Android |
|--------|-----|---------|
| API | AVAudioEngine | AudioRecord |
| Sample rates | 8-192 kHz | 8-48 kHz typical |
| Bit depth | 16/24/32-bit | 16-bit common |
| Latency | ~5-20ms | ~10-50ms |
| Echo cancel | Built-in (voiceChat) | AcousticEchoCanceler |
| Noise suppress | Built-in (voiceChat) | NoiseSuppressor |

### Background Execution

| Aspect | iOS | Android |
|--------|-----|---------|
| Mechanism | Background modes | Foreground service |
| User visibility | None / Now Playing | Persistent notification |
| Duration | Unlimited with audio | Unlimited with service |
| Kill protection | Medium | High (foreground) |
| Battery optimization | Automatic | Doze mode concerns |

### Lock Screen Integration

| Aspect | iOS | Android |
|--------|-----|---------|
| Media controls | MPNowPlayingInfoCenter | MediaSession |
| Call UI | CallKit | ConnectionService |
| Notifications | Rich notifications | Notification actions |
| Widgets | Live Activities (iOS 16+) | App widgets |

### Bluetooth Audio

| Aspect | iOS | Android |
|--------|-----|---------|
| Headset buttons | MPRemoteCommandCenter | MediaSession callbacks |
| Audio routing | AVAudioSession | AudioManager |
| HFP profile | Automatic with CallKit | ConnectionService required |
| A2DP profile | Automatic | Automatic |

## Implementation Effort Comparison

### Simple Background Audio

| Task | iOS Effort | Android Effort |
|------|-----------|----------------|
| Audio playback | Low | Low |
| Audio recording | Low | Low |
| Background mode | Low (Info.plist) | Medium (Service) |
| Lock screen controls | Medium | Medium |
| **Total** | **Low-Medium** | **Medium** |

### Call-Like Experience

| Task | iOS Effort | Android Effort |
|------|-----------|----------------|
| CallKit setup | Medium | - |
| ConnectionService setup | - | High |
| Audio routing | Low (automatic) | Medium |
| UI integration | Low (automatic) | Medium |
| App Store/Play Store | Medium (review) | Low |
| **Total** | **Medium** | **High** |

## Recommendations

### MVP (Both Platforms)

1. **iOS**: Use `.playAndRecord` + `UIBackgroundModes: audio, voip`
2. **Android**: Use foreground service with media + microphone types
3. Both: Use media session/now playing for lock screen controls

### Full Experience (Stretch)

1. **iOS**: Integrate CallKit for call-like UI
2. **Android**: Implement ConnectionService (complex)
3. Consider: iOS-first approach due to lower effort for call integration

### Cross-Platform Code Sharing

```typescript
// Shared interface
interface VoiceSession {
  start(): Promise<void>
  stop(): Promise<void>
  mute(): void
  unmute(): void
  onAudioData: (callback: (data: Float32Array) => void) => void
}

// Platform-specific implementations
// iOS: AVAudioEngine wrapper
// Android: AudioRecord wrapper
```

## Risk Assessment

| Risk | iOS | Android | Mitigation |
|------|-----|---------|------------|
| App rejection | Medium (CallKit) | Low | Document VoIP use case |
| Battery drain | Low | Medium | Optimize audio processing |
| Audio interruption | Medium | Low | Handle focus changes |
| Bluetooth issues | Low | Medium | Test thoroughly |
| Background kill | Low | Medium (Doze) | User education |

## Testing Checklist

### iOS
- [ ] Background audio continues when locked
- [ ] Lock screen controls work
- [ ] Audio resumes after phone call
- [ ] Bluetooth headset buttons work
- [ ] CarPlay integration (if CallKit)
- [ ] Memory pressure handling

### Android
- [ ] Foreground service notification visible
- [ ] Audio continues when locked
- [ ] Notification actions work
- [ ] Audio resumes after phone call
- [ ] Bluetooth headset buttons work
- [ ] Doze mode handling
- [ ] Battery optimization whitelist prompt
