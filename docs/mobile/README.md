# OpenCode Mobile

This document outlines the strategy for building OpenCode mobile applications for iOS and Android.

## Overview

The OpenCode mobile app provides a **hands-free voice interface** for interacting with the OpenCode agent. Unlike the desktop app which runs a local sidecar server, the mobile client connects to a **remote OpenCode server** (running on your desktop, a cloud instance, or self-hosted infrastructure).

### Primary Use Case

- Voice-driven interaction with the OpenCode agent
- Hands-free coding assistance while away from keyboard
- Real-time voice input/output similar to ChatGPT Voice
- Background audio support for continuous conversations

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Mobile Client                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              SolidJS UI (@opencode-ai/ui)           │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │           Platform Abstraction Layer                 │   │
│  │  • Voice capture (background audio)                  │   │
│  │  • Audio playback (text-to-speech)                   │   │
│  │  • Push notifications                                │   │
│  │  • Secure storage (Keychain/Keystore)               │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Tauri Mobile Runtime                    │   │
│  │         (WKWebView iOS / WebView Android)           │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ WebSocket / HTTP
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Remote OpenCode Server                    │
│  • Desktop app with sidecar                                 │
│  • Cloud-hosted instance                                    │
│  • Self-hosted server                                       │
└─────────────────────────────────────────────────────────────┘
```

## Key Differences from Desktop

| Aspect | Desktop | Mobile |
|--------|---------|--------|
| Server | Local sidecar subprocess | Remote connection |
| Primary Input | Keyboard/Mouse | Voice |
| Primary Output | Text/Code display | Voice + Text |
| Background Mode | N/A | Required for voice |
| Platform | macOS, Windows, Linux | iOS, Android |

## Technology Stack

- **Framework**: Tauri v2 (mobile support)
- **UI**: SolidJS (shared with desktop/web)
- **Voice**: Platform-native audio APIs
- **Transport**: WebSocket for real-time communication
- **Build**: Xcode (iOS), Android Studio (Android)

## Documentation

| Document | Description |
|----------|-------------|
| [TAURI_MOBILE.md](./TAURI_MOBILE.md) | Tauri mobile setup and configuration |
| [ANDROID_TESTING.md](./ANDROID_TESTING.md) | Testing on real Android devices |
| [VOICE_BACKGROUND_AUDIO.md](./VOICE_BACKGROUND_AUDIO.md) | Background audio research and implementation |
| [PLATFORM_CAPABILITIES.md](./PLATFORM_CAPABILITIES.md) | iOS vs Android feature comparison |

## Getting Started

### Prerequisites

**iOS Development:**
- macOS with Xcode 15+
- Apple Developer account
- iOS 14+ target

**Android Development:**
- Android Studio
- Android SDK (API 24+)
- JDK 17+

### Setup (Future)

```bash
# Install Tauri mobile CLI
cargo install tauri-cli

# Initialize mobile targets
cd packages/mobile
cargo tauri android init
cargo tauri ios init

# Run on simulator
cargo tauri ios dev
cargo tauri android dev
```

## Roadmap

### Phase 1: Foundation
- [ ] Create `packages/mobile` with Tauri mobile configuration
- [ ] Implement `Platform` interface for mobile
- [ ] Remote server connection (WebSocket)
- [ ] Basic text chat UI

### Phase 2: Voice Integration
- [ ] Voice input capture
- [ ] Text-to-speech output
- [ ] Real-time voice streaming to server

### Phase 3: Background Audio (Stretch Goal)
- [ ] iOS background audio mode
- [ ] Android foreground service
- [ ] Call-like UI experience
- [ ] Lock screen controls

### Phase 4: Polish
- [ ] Push notifications
- [ ] Offline message queue
- [ ] App Store / Play Store submission

## Related Documents

- [Voice Integration RFC](../rfcs/voice-integration.md) (if exists)
- [Desktop Architecture](../../packages/desktop/README.md)
