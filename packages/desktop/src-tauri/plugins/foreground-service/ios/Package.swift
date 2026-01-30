// swift-tools-version:5.3
// Copyright 2019-2024 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

import PackageDescription

let package = Package(
  name: "tauri-plugin-foreground-service",
  platforms: [
    .iOS(.v14),
  ],
  products: [
    .library(
      name: "tauri-plugin-foreground-service",
      type: .static,
      targets: ["tauri-plugin-foreground-service"])
  ],
  dependencies: [
    .package(name: "Tauri", path: "../.tauri/tauri-api")
  ],
  targets: [
    .target(
      name: "tauri-plugin-foreground-service",
      dependencies: [
        .byName(name: "Tauri")
      ],
      path: "Sources")
  ]
)
