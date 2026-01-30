use std::collections::HashMap;
use std::path::Path;

const ENV_KEYS: &[&str] = &[
    "OPENCODE_SERVER_URL",
    "OPENCODE_SERVER_USERNAME",
    "OPENCODE_SERVER_PASSWORD",
];

/// Parse a .env file into key-value pairs.
/// Ignores blank lines, comments (#), and keys not in ENV_KEYS.
fn load_dotenv(path: &Path) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let Ok(contents) = std::fs::read_to_string(path) else {
        return map;
    };
    for line in contents.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((key, value)) = line.split_once('=') {
            let key = key.trim();
            if ENV_KEYS.contains(&key) {
                map.insert(key.to_string(), value.trim().to_string());
            }
        }
    }
    map
}

fn main() {
    // Re-run build script when env vars or .env file change
    for key in ENV_KEYS {
        println!("cargo:rerun-if-env-changed={key}");
    }
    println!("cargo:rerun-if-changed=../.env");

    // Load values from .env file as defaults
    let dotenv = load_dotenv(Path::new("../.env"));

    // Forward to rustc: shell env takes precedence over .env file
    for key in ENV_KEYS {
        let value = std::env::var(key).ok().or_else(|| dotenv.get(*key).cloned());
        if let Some(value) = value {
            println!("cargo:rustc-env={key}={value}");
        }
    }

    tauri_build::build()
}
