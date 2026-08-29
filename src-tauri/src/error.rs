use serde::ser::{Serialize, SerializeStruct, Serializer};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("database operation failed: {0}")]
    Database(#[from] sqlx::Error),
    #[error("file operation failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("invalid input: {0}")]
    InvalidInput(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("source PDF is missing: {0}")]
    FileMissing(String),
    #[error("platform operation failed: {0}")]
    Platform(String),
    #[error("AI service failed: {0}")]
    Ai(String),
    #[error("AI provider is not configured: {0}")]
    AiUnconfigured(String),
}

impl AppError {
    fn code(&self) -> &'static str {
        match self {
            Self::Database(_) => "database_error",
            Self::Io(_) => "io_error",
            Self::InvalidInput(_) => "invalid_input",
            Self::NotFound(_) => "not_found",
            Self::FileMissing(_) => "file_missing",
            Self::Platform(_) => "platform_error",
            Self::Ai(_) => "ai_error",
            Self::AiUnconfigured(_) => "ai_unconfigured",
        }
    }
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut state = serializer.serialize_struct("AppError", 2)?;
        state.serialize_field("code", self.code())?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}
