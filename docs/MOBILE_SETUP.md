# OpenCode Mobile Setup Guide

Get OpenCode running on iOS and Android simulators/emulators.

## Table of Contents

- [Status](#status)
- [Prerequisites](#prerequisites)
- [iOS Setup](#ios-setup)
- [Android Setup](#android-setup)
- [Quick Command Reference](#quick-command-reference)
- [Key Implementation Details](#key-implementation-details)
- [Troubleshooting](#troubleshooting)
- [What's Working](#whats-working)

## Status

- ✅ iOS & Android text chat fully working
- ✅ Server connection and UI rendering
- ✅ Voice mode (OpenAI Realtime via WebRTC in the WebView)
- 🔶 Background voice (Android foreground service integration exists, but WebView/WebRTC background behavior is device-dependent)

**Architecture**: Mobile uses `packages/desktop/` (not `packages/app/`). Desktop spawns local server, mobile connects to remote server.

---

## Prerequisites

- macOS 11+ or Linux, Xcode 13+ (iOS, macOS only), Android Studio (Android)
- Rust: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- Bun: `curl -fsSL https://bun.sh/install | bash`
- **Linux only (for physical Android devices)**: `sudo apt install android-sdk-platform-tools-common` (installs udev rules for USB debugging)

---

## iOS Setup

```bash
# Install dependencies (Xcode from App Store required)
brew install cocoapods

# Initialize (Tauri will install iOS Rust targets automatically)
cd packages/desktop
bun run tauri ios init

# Run
# Terminal 1:
cd packages/opencode && bun run --conditions=browser ./src/index.ts serve --port 4096

# Terminal 2:
cd packages/desktop && bun run tauri ios dev
```

---

## Android Setup

**1. Install Android Studio** from https://developer.android.com/studio

**2. Install SDK Components** via Android Studio SDK Manager (Settings → System Settings → Android SDK):

- **SDK Platforms** tab: Install Android 13.0 (API 33) or higher
- **SDK Tools** tab: Check and install:
  - Android SDK Command-line Tools (latest)
  - Android SDK Platform-Tools
  - Android SDK Build-Tools
  - Android Emulator
  - NDK (Side by side) - any recent version

**3. Configure Environment**: Ensure `ANDROID_HOME` is set and SDK tools are in PATH (Android Studio usually handles this automatically)

**4. Initialize** (Tauri will install Rust targets and accept SDK licenses):

```bash
cd packages/desktop
bun run tauri android init
```

**5. Connect a Device** (physical phone or emulator — one must be available before running `tauri android dev`):

**Option A: Physical device (recommended)** — plug in via USB with USB debugging enabled:

```bash
# Enable USB debugging: Settings → Developer Options → USB Debugging
# (Enable Developer Options first: Settings → About Phone → tap "Build Number" 7 times)
adb devices                   # should show your device as "device"
```

**Option B: Emulator** — `tauri android dev` does **not** start an emulator automatically.

```bash
# Create emulator (if needed): Android Studio → Tools → Device Manager → Create Virtual Device

# Option A: Start from Android Studio Device Manager (click play button)
# Option B: Start from command line:
emulator -list-avds           # list available emulators
emulator -avd <AVD_NAME>      # start one (e.g. Medium_Phone_API_36)
```

**6. Run** (device/emulator must be available first):

```bash
# Terminal 1: Start the OpenCode backend server
# For physical devices, use --hostname 0.0.0.0 so the phone can reach it over the network
cd packages/opencode && bun run --conditions=browser ./src/index.ts serve --port 4096 --hostname 0.0.0.0

# Terminal 2: Build and deploy to device
cd packages/desktop && bun run tauri android dev
```

> **Note:** For physical devices, Tauri sets `TAURI_DEV_HOST` to your machine's LAN IP at build time. The app uses this to connect to the backend server. For emulators, it falls back to `10.0.2.2`.

---

## Quick Command Reference

### iOS (One-time setup)

```bash
# 1. Install Xcode from App Store

# 2. Install CocoaPods
brew install cocoapods

# 3. Initialize iOS
cd packages/desktop
bun run tauri ios init
```

### iOS (Every run)

```bash
# Terminal 1: Start server
cd packages/opencode
bun run --conditions=browser ./src/index.ts serve --port 4096

# Terminal 2: Run iOS app
cd packages/desktop
bun run tauri ios dev
```

---

### Android (One-time setup)

```bash
# 1. Install Android Studio from https://developer.android.com/studio

# 2. Open Android Studio → Settings → Android SDK
#    - SDK Platforms: Install Android 13.0+ (API 33+)
#    - SDK Tools: Check Command-line Tools, Platform-Tools, Build-Tools, Emulator, NDK

# 3. Initialize Android
cd packages/desktop
bun run tauri android init
```

### Android (Every run — physical device)

```bash
# Terminal 1: Start server (--hostname 0.0.0.0 required for physical devices)
cd packages/opencode
bun run --conditions=browser ./src/index.ts serve --port 4096 --hostname 0.0.0.0

# Terminal 2: Run Android app
cd packages/desktop
bun run tauri android dev
```

### Android (Every run — emulator)

```bash
# Terminal 1: Start emulator (must be running before tauri android dev)
emulator -avd <AVD_NAME>

# Terminal 2: Start server
cd packages/opencode
bun run --conditions=browser ./src/index.ts serve --port 4096

# Terminal 3: Run Android app
cd packages/desktop
bun run tauri android dev
```

---

## Key Implementation Details

**Network (two connections)**:

- **Port 1420** (Vite dev server): Serves the frontend UI. Tauri handles connectivity automatically (ADB forwarding for emulators, `TAURI_DEV_HOST` LAN IP for physical devices).
- **Port 4096** (OpenCode backend): The actual API server. Physical Android devices connect via the host's LAN IP (detected from `TAURI_DEV_HOST` at build time). Emulators use `10.0.2.2` (Android's alias for host localhost). iOS uses `localhost:4096` directly.
- **Physical devices require** `--hostname 0.0.0.0` on the server so it's reachable over the network.

**File Pickers**: Native pickers disabled on mobile, uses server-based directory picker

**Plugins**: Desktop-only plugins (`single_instance`, `window_state`, `decorum`) excluded on mobile

**Build**: Sidecar skipped for mobile targets (no local server on mobile)

---

## Troubleshooting

**"OpenCode failed to start"**: Ensure server running on port 4096, check firewall

**"NDK not found" or init fails**: Ensure NDK is installed via Android Studio SDK Manager (SDK Tools tab → NDK)

**iOS "xcodegen not found"**: `brew install xcodegen` (only if you get this error during init)

**White screen / unable to connect to localhost:1420**: The Vite dev server on port 1420 is not reachable from the emulator. Try:

1. Clear stale ADB forwarding and restart: `adb reverse --remove-all` then re-run `bun run tauri android dev`
2. Verify forwarding is active: `adb reverse --list` (should show `tcp:1420 tcp:1420`)
3. Make sure the emulator was started **before** running `tauri android dev`

**"No server URL configured" / can't reach backend**: The OpenCode server on port 4096 must be running on the host machine. For physical devices, ensure you started the server with `--hostname 0.0.0.0` and that the phone and computer are on the same Wi-Fi network. For emulators, the app connects via `10.0.2.2:4096`. Verify server is running: `curl http://localhost:4096/global/health`

**iOS build fails**: Clean build with `rm -rf ~/Library/Developer/Xcode/DerivedData`

**ADB "no permissions" on Linux**: Install udev rules: `sudo apt install android-sdk-platform-tools-common`, then unplug and replug the device

**No Android emulators**: Create via Android Studio → Tools → Device Manager

---

## What's Working

✅ Text chat, UI rendering, project selection, server connection
✅ Voice mode (mic permission + WebRTC session + transcript persistence)
🔶 Background voice on Android (foreground service helps keep the process alive; see `docs/mobile/ANDROID_FOREGROUND_SERVICE.md`)
❌ Lock screen controls (not implemented)
