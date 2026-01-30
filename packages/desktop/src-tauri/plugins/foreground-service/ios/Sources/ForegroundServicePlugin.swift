import Tauri
import UIKit

class ForegroundServicePlugin: Plugin {
  @objc func startService(_ invoke: Invoke) {
    // No-op on iOS — background audio handled via AVAudioSession
    invoke.resolve()
  }

  @objc func stopService(_ invoke: Invoke) {
    // No-op on iOS
    invoke.resolve()
  }
}

@_cdecl("init_plugin_foreground_service")
func initPlugin() -> Plugin {
  return ForegroundServicePlugin()
}
