import { $ } from "bun"

import { copyBinaryToSidecarFolder, getCurrentSidecar, windowsify } from "./utils"

const RUST_TARGET = Bun.env.TAURI_ENV_TARGET_TRIPLE

console.log(`[predev] RUST_TARGET=${RUST_TARGET}`)

// Skip sidecar build for mobile targets (mobile connects to remote server)
const isMobileTarget = RUST_TARGET && (RUST_TARGET.includes("apple-ios") || RUST_TARGET.includes("linux-android"))

if (isMobileTarget) {
  console.log(`[predev] Skipping sidecar build for mobile target: ${RUST_TARGET}`)
  process.exit(0)
}

// If no RUST_TARGET, we're probably being run manually (not by Tauri)
// Skip sidecar build in this case
if (!RUST_TARGET) {
  console.log(`[predev] No RUST_TARGET set, skipping sidecar build`)
  process.exit(0)
}

const sidecarConfig = getCurrentSidecar(RUST_TARGET)

const binaryPath = windowsify(`../opencode/dist/${sidecarConfig.ocBinary}/bin/opencode`)

await $`cd ../opencode && bun run build --single`

await copyBinaryToSidecarFolder(binaryPath, RUST_TARGET)
