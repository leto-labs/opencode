// Copyright 2019-2024 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioConfig {
    pub sample_rate: u32,
    pub channels: u32,
}

impl Default for AudioConfig {
    fn default() -> Self {
        Self {
            sample_rate: 16000,
            channels: 1,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioData {
    pub data: Vec<i16>, // PCM16 audio data
    pub sample_rate: u32,
    pub channels: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionStatus {
    pub microphone: String, // "granted", "denied", "prompt"
}
