# OpenCode Mobile

Mobile app for iOS and Android, built with Tauri v2 using the shared `packages/desktop/` codebase.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Key Differences from Desktop](#key-differences-from-desktop)
- [Getting Started](#getting-started)
- [Documentation](#documentation)

## Overview

The mobile app provides the full OpenCode UI (text chat + voice mode) on phones and tablets. Unlike desktop which spawns a local sidecar server, mobile connects to a **remote OpenCode server** running on your computer or a cloud instance.

### Current Status

- Text chat, UI rendering, project selection, server connection
- Voice mode (OpenAI Realtime WebRTC)
- Android background voice support via foreground service plugin (device-dependent; see [ANDROID_FOREGROUND_SERVICE.md](./ANDROID_FOREGROUND_SERVICE.md) and [VOICE_BACKGROUND_AUDIO.md](./VOICE_BACKGROUND_AUDIO.md))

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Mobile Client                            │
│               (packages/desktop/)                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │          SolidJS UI (@opencode-ai/app)              │   │
│  │     Shared with desktop and web                      │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Tauri Mobile Runtime                    │   │
│  │         (WKWebView iOS / WebView Android)           │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │           Rust + Native Plugins                      │   │
│  │  • Server discovery (TAURI_DEV_HOST / 10.0.2.2)     │   │
│  │  • Foreground service (Kotlin/Swift)                  │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                          │
          HTTP / WebSocket (API) + WebRTC (voice)
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                   Remote OpenCode Server                    │
│          (desktop sidecar, cloud, or self-hosted)           │
└─────────────────────────────────────────────────────────────┘
```

## Key Differences from Desktop

| Aspect           | Desktop                  | Mobile                                       |
| ---------------- | ------------------------ | -------------------------------------------- |
| Server           | Local sidecar subprocess | Remote connection                            |
| Input            | Keyboard/Mouse + Voice   | Touch + Voice                                |
| Voice transport  | WebRTC in WebView        | WebRTC in WebView (same)                     |
| Background voice | N/A                      | Device-dependent (foreground service plugin) |
| File pickers     | Native OS dialogs        | Server-based directory picker                |
| Build            | Single binary            | Xcode (iOS) / Gradle (Android)               |

## Getting Started

See [MOBILE_SETUP.md](../MOBILE_SETUP.md) for setup instructions (prerequisites, building, running).

## Documentation

| Document                                                         | Description                                               |
| ---------------------------------------------------------------- | --------------------------------------------------------- |
| [MOBILE_SETUP.md](../MOBILE_SETUP.md)                            | Build and run instructions for iOS and Android            |
| [VOICE_BACKGROUND_AUDIO.md](./VOICE_BACKGROUND_AUDIO.md)         | Voice architecture and background audio challenges        |
| [ANDROID_FOREGROUND_SERVICE.md](./ANDROID_FOREGROUND_SERVICE.md) | Foreground service plugin (Android Kotlin implementation) |
| [ANDROID_TESTING.md](./ANDROID_TESTING.md)                       | Testing on physical Android devices                       |
| [PLATFORM_CAPABILITIES.md](./PLATFORM_CAPABILITIES.md)           | iOS vs Android capability comparison                      |
| [TAURI_MOBILE.md](./TAURI_MOBILE.md)                             | Tauri v2 mobile configuration details                     |
