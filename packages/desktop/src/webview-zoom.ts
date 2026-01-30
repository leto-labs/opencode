// Copyright 2019-2024 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

import { invoke } from "@tauri-apps/api/core"
import { type as ostype } from "@tauri-apps/plugin-os"

let zoomLevel = 1

const MAX_ZOOM_LEVEL = 10
const MIN_ZOOM_LEVEL = 0.2

// Lazy getter for OS name - only call when needed, with error handling for mobile
function getOSName() {
  try {
    return ostype()
  } catch {
    // Mobile or Tauri not ready yet
    return "unknown"
  }
}

window.addEventListener("keydown", (event) => {
  const osName = getOSName()
  if (osName === "macos" ? event.metaKey : event.ctrlKey) {
    if (event.key === "-") {
      zoomLevel -= 0.2
    } else if (event.key === "=" || event.key === "+") {
      zoomLevel += 0.2
    } else if (event.key === "0") {
      zoomLevel = 1
    } else {
      return
    }
    zoomLevel = Math.min(Math.max(zoomLevel, MIN_ZOOM_LEVEL), MAX_ZOOM_LEVEL)
    invoke("plugin:webview|set_webview_zoom", {
      value: zoomLevel,
    })
  }
})
