# Android Build Guide

## Prerequisites

- Android SDK and NDK installed (auto-detected from `~/Android/Sdk`)
- Rust toolchain with Android targets
- `bun` package manager

## Environment Configuration

Create a `.env` file in `packages/desktop/`:

```env
OPENCODE_SERVER_URL=https://your-server.example.com
OPENCODE_SERVER_PASSWORD=your-password
# OPENCODE_SERVER_USERNAME=opencode  # optional, defaults to "opencode"
```

These values are read by `build.rs` at compile time and baked into the binary via `option_env!()`. The `.env` file is parsed directly by the build script — no need to export variables in your shell.

> **Priority**: `OPENCODE_SERVER_URL` always takes precedence over the `TAURI_DEV_HOST`-based default URL. If not set, the app falls back to `http://<TAURI_DEV_HOST>:4096` (physical device) or `http://10.0.2.2:4096` (emulator).

## Dev Build (on-device debugging)

```bash
cd packages/desktop
bun run tauri android dev
```

This starts a Vite dev server on your machine and loads the app via HMR. Sluggish compared to release builds due to debug symbols, no minification, and HMR overhead.

## Release Build

### 1. Build the APK

```bash
cd packages/desktop
bun run tauri android build
```

Output:

- **APK**: `src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk`
- **AAB**: `src-tauri/gen/android/app/build/outputs/bundle/universalRelease/app-universal-release.aab`

### 2. Sign the APK

The release APK is unsigned. For local testing, sign with the Android debug keystore:

```bash
APKSIGNER="$ANDROID_HOME/build-tools/36.1.0/apksigner"
APK="src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk"
SIGNED_APK="src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-signed.apk"

cp "$APK" "$SIGNED_APK"
"$APKSIGNER" sign --ks ~/.android/debug.keystore --ks-pass pass:android --key-pass pass:android "$SIGNED_APK"
```

> **Note**: The debug keystore is fine for sideloading. For Play Store distribution, use a proper release keystore.

### 3. Install on device

```bash
adb install "$SIGNED_APK"
```

If `adb` is not on your PATH:

```bash
$ANDROID_HOME/platform-tools/adb install "$SIGNED_APK"
```

## Troubleshooting

### Environment variables not picked up

`build.rs` reads the `.env` file directly and forwards values via `cargo:rustc-env`. If values seem stale, force a clean rebuild:

```bash
cd packages/desktop/src-tauri
cargo clean
```

### Cleartext traffic blocked

Release builds disable cleartext HTTP traffic. Use `https://` URLs for `OPENCODE_SERVER_URL`, or switch to a dev build for testing against local HTTP servers.
