# OpenCode Mobile Setup Guide

Get OpenCode running on iOS and Android simulators/emulators.

## Status

- ✅ iOS & Android text chat fully working
- ✅ Server connection and UI rendering
- ⏸️ Voice mode (native plugins exist but not connected to OpenAI)

**Architecture**: Mobile uses `packages/desktop/` (not `packages/app/`). Desktop spawns local server, mobile connects to remote server.

---

## Prerequisites

- macOS 11+, Xcode 13+ (iOS), Android Studio (Android)
- Rust: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- Bun: `curl -fsSL https://bun.sh/install | bash`

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

**5. Run**:
```bash
# Terminal 1:
cd packages/opencode && bun run --conditions=browser ./src/index.ts serve --port 4096

# Terminal 2:
cd packages/desktop && bun run tauri android dev
```

**Create Emulator** (if needed): Use Android Studio → Tools → Device Manager

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

### Android (Every run)
```bash
# Terminal 1: Start server
cd packages/opencode
bun run --conditions=browser ./src/index.ts serve --port 4096

# Terminal 2: Run Android app
cd packages/desktop
bun run tauri android dev
```

---

## Key Implementation Details

**Network**: iOS uses `localhost:4096`, Android uses `10.0.2.2:4096` (automatic)

**File Pickers**: Native pickers disabled on mobile, uses server-based directory picker

**Plugins**: Desktop-only plugins (`single_instance`, `window_state`, `decorum`) excluded on mobile

**Build**: Sidecar skipped for mobile targets (no local server on mobile)

---

## Troubleshooting

**"OpenCode failed to start"**: Ensure server running on port 4096, check firewall

**"NDK not found" or init fails**: Ensure NDK is installed via Android Studio SDK Manager (SDK Tools tab → NDK)

**iOS "xcodegen not found"**: `brew install xcodegen` (only if you get this error during init)

**White screen**: Check terminal for Rust panics, verify server health: `curl http://localhost:4096/global/health`

**iOS build fails**: Clean build with `rm -rf ~/Library/Developer/Xcode/DerivedData`

**No Android emulators**: Create via Android Studio → Tools → Device Manager

---

## What's Working

✅ Text chat, UI rendering, project selection, server connection
⏸️ Voice mode (native plugins exist but not connected to OpenAI)
❌ Background audio, lock screen controls
