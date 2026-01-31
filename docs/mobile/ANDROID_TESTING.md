# Testing OpenCode on Android Phone

Quick guide to run and test the OpenCode mobile app on your Android phone.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Steps to Test on Your Phone](#steps-to-test-on-your-phone)
- [Troubleshooting](#troubleshooting)
- [See Also](#see-also)

## Prerequisites

- **Rust**: Install from [rustup.rs](https://rustup.rs/)
- **Android Studio**: For Android SDK ([download](https://developer.android.com/studio))
- **Android phone**: Running Android 7.0+ with a USB cable

**First time setup:**

```bash
# Install Rust if you don't have it
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Restart terminal, then install dependencies
cd packages/desktop
bun install
```

**Note:** OpenCode already includes `@tauri-apps/cli` as a dependency, so you don't need to install it globally.

[Tauri prerequisites guide](https://v2.tauri.app/guides/prerequisites/)

## Steps to Test on Your Phone

### 1. Enable Developer Mode on Your Phone

1. Open **Settings** → **About phone**
2. Tap **Build number** 7 times until you see "You are now a developer!"
3. Go to **Settings** → **System** → **Developer options**
4. Enable **USB debugging**

[Android developer options guide](https://developer.android.com/studio/debug/dev-options)

### 2. Connect Your Phone

1. Plug your phone into your computer with a USB cable
2. On your phone, tap **Allow** when you see "Allow USB debugging?"
3. Optionally check "Always allow from this computer"

### 3. Run the App

```bash
cd packages/desktop
bun run tauri android dev
```

That's it! The app will build, install on your phone, and launch automatically.

[Tauri Android CLI documentation](https://v2.tauri.app/reference/cli/#android)

### 4. Test the App

1. The app should open on your phone
2. Try starting a voice session
3. Tap **Allow** when asked for microphone permission
4. Check your terminal for logs:
   ```
   [realtime] requesting microphone permission
   [realtime] microphone permission granted
   ```

## Troubleshooting

### Device not found

**Solutions:**

- Make sure USB cable supports data (not just charging)
- Check you tapped "Allow" on your phone
- Try unplugging and plugging back in
- Try a different USB port

[Android USB debugging troubleshooting](https://developer.android.com/tools/adb#Enabling)

### Build fails

| Error                       | Solution                                                          |
| --------------------------- | ----------------------------------------------------------------- |
| "ANDROID_HOME not set"      | Install Android Studio or set `ANDROID_HOME` environment variable |
| "Gradle sync failed"        | Open `src-tauri/gen/android` in Android Studio and sync           |
| "NDK not found"             | Install NDK via Android Studio SDK Manager                        |
| "Java version incompatible" | Install JDK 17+                                                   |

[Tauri Android prerequisites](https://v2.tauri.app/guides/prerequisites/#android)

### App crashes

- Look at the terminal logs for error messages
- Make sure your phone is Android 7.0 or newer
- Check AndroidManifest.xml has required permissions

### Microphone doesn't work

**Permission dialog doesn't appear:**

- Verify AndroidManifest.xml includes `<uses-permission android:name="android.permission.RECORD_AUDIO" />`

**Permission denied:**

1. Go to **Settings** → **Apps** → **OpenCode** → **Permissions**
2. Enable **Microphone**
3. Restart the app

[Android permissions guide](https://developer.android.com/guide/topics/permissions/overview)

## See Also

- [TAURI_MOBILE.md](./TAURI_MOBILE.md) - Full Tauri mobile setup
- [Tauri Mobile Guide](https://v2.tauri.app/guides/mobile/)
- [Android Developer Documentation](https://developer.android.com/)
