// Copyright 2019-2024 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

#![cfg(mobile)]

use tauri::{
    plugin::{Builder, PluginHandle, TauriPlugin},
    Manager, Runtime,
};

pub use models::*;

mod error;
mod models;

pub use error::{Error, Result};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_audio_bridge);

/// Access to the audio bridge APIs.
pub struct AudioBridge<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> AudioBridge<R> {
    /// Start capturing audio from microphone
    pub fn start_capture(&self, config: AudioConfig) -> Result<()> {
        self.0
            .run_mobile_plugin("startCapture", config)
            .map_err(Into::into)
    }

    /// Stop capturing audio
    pub fn stop_capture(&self) -> Result<()> {
        self.0
            .run_mobile_plugin("stopCapture", ())
            .map_err(Into::into)
    }

    /// Play audio data
    pub fn play_audio(&self, data: AudioData) -> Result<()> {
        self.0
            .run_mobile_plugin("playAudio", data)
            .map_err(Into::into)
    }

    /// Check microphone permission status
    pub fn check_permissions(&self) -> Result<PermissionStatus> {
        self.0
            .run_mobile_plugin("checkPermissions", ())
            .map_err(Into::into)
    }

    /// Request microphone permission
    pub fn request_permissions(&self) -> Result<PermissionStatus> {
        self.0
            .run_mobile_plugin("requestPermissions", ())
            .map_err(Into::into)
    }
}

/// Extensions to [`tauri::App`], [`tauri::AppHandle`], [`tauri::WebviewWindow`], [`tauri::Webview`] and [`tauri::Window`] to access the audio bridge APIs.
pub trait AudioBridgeExt<R: Runtime> {
    fn audio_bridge(&self) -> &AudioBridge<R>;
}

impl<R: Runtime, T: Manager<R>> AudioBridgeExt<R> for T {
    fn audio_bridge(&self) -> &AudioBridge<R> {
        self.state::<AudioBridge<R>>().inner()
    }
}

/// Initializes the plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("audio-bridge")
        .setup(|app, api| {
            #[cfg(target_os = "ios")]
            let handle = api.register_ios_plugin(init_plugin_audio_bridge)?;
            app.manage(AudioBridge(handle));
            Ok(())
        })
        .build()
}
