// Copyright 2019-2024 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

const COMMANDS: &[&str] = &["startService", "stopService"];

fn main() {
    // Tell cargo about the mobile cfg
    println!("cargo::rustc-check-cfg=cfg(mobile)");
    println!("cargo:rerun-if-changed=build.rs");

    let result = tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .try_build();

    // when building documentation for Android the plugin build result is always Err() and is irrelevant to the crate documentation build
    if !(cfg!(docsrs) && std::env::var("TARGET").unwrap_or_default().contains("android")) {
        if let Err(e) = result {
            // Only fail if this is a mobile build
            if std::env::var("CARGO_CFG_TARGET_OS")
                .map(|os| os == "android" || os == "ios")
                .unwrap_or(false)
            {
                panic!("Failed to build plugin: {}", e);
            }
        }
    }
}
