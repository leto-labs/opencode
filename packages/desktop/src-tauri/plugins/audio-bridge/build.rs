// Copyright 2019-2024 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

fn main() {
    // Tell cargo about the mobile cfg
    println!("cargo::rustc-check-cfg=cfg(mobile)");
    println!("cargo:rerun-if-changed=build.rs");
}
