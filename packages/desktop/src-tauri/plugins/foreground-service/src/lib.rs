#![cfg(mobile)]

use tauri::{
    plugin::{Builder, PluginHandle, TauriPlugin},
    Manager, Runtime,
};

mod error;

pub use error::{Error, Result};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_foreground_service);

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "app.tauri.foregroundservice";

/// Access to the foreground service APIs.
pub struct ForegroundServicePlugin<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> ForegroundServicePlugin<R> {
    /// Start the foreground service (notification + wake lock).
    /// Used to keep the WebView alive during background voice sessions.
    pub fn start_service(&self) -> Result<()> {
        self.0
            .run_mobile_plugin("startService", ())
            .map_err(Into::into)
    }

    /// Stop the foreground service.
    pub fn stop_service(&self) -> Result<()> {
        self.0
            .run_mobile_plugin("stopService", ())
            .map_err(Into::into)
    }
}

/// Extensions to [`tauri::App`], [`tauri::AppHandle`], [`tauri::WebviewWindow`], [`tauri::Webview`] and [`tauri::Window`] to access the foreground service APIs.
pub trait ForegroundServiceExt<R: Runtime> {
    fn foreground_service(&self) -> &ForegroundServicePlugin<R>;
}

impl<R: Runtime, T: Manager<R>> ForegroundServiceExt<R> for T {
    fn foreground_service(&self) -> &ForegroundServicePlugin<R> {
        self.state::<ForegroundServicePlugin<R>>().inner()
    }
}

/// Initializes the plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("foreground-service")
        .setup(|app, api| {
            #[cfg(target_os = "ios")]
            let handle = api.register_ios_plugin(init_plugin_foreground_service)?;
            #[cfg(target_os = "android")]
            let handle =
                api.register_android_plugin(PLUGIN_IDENTIFIER, "ForegroundServicePlugin")?;
            app.manage(ForegroundServicePlugin(handle));
            Ok(())
        })
        .build()
}
