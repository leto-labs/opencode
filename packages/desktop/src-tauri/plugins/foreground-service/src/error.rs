use serde::{Serialize, Serializer};

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Service error: {0}")]
    ServiceError(String),

    #[error(transparent)]
    Tauri(#[from] tauri::Error),

    #[error("Plugin invoke error: {0}")]
    PluginInvoke(String),
}

impl From<tauri::plugin::mobile::PluginInvokeError> for Error {
    fn from(err: tauri::plugin::mobile::PluginInvokeError) -> Self {
        Error::PluginInvoke(err.to_string())
    }
}

impl Serialize for Error {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}
