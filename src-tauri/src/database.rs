use sqlx::{
    migrate::Migrator,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
    SqlitePool,
};
use std::{collections::HashMap, sync::Arc};
use std::{path::Path, time::Duration};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

use crate::{ai::AIServiceManager, diagnostics, error::AppError};

static MIGRATOR: Migrator = sqlx::migrate!("./migrations");

pub struct AppState {
    pub pool: SqlitePool,
    pub ai_requests: Arc<Mutex<HashMap<String, CancellationToken>>>,
    pub managed_ai: Arc<AIServiceManager>,
}

pub async fn connect(data_dir: &Path) -> Result<SqlitePool, AppError> {
    std::fs::create_dir_all(data_dir)?;
    let database_path = data_dir.join("scholar-reader.db");
    let options = SqliteConnectOptions::new()
        .filename(&database_path)
        .create_if_missing(true)
        .foreign_keys(true)
        .journal_mode(SqliteJournalMode::Wal)
        .busy_timeout(Duration::from_secs(5));

    let pool = SqlitePoolOptions::new()
        .max_connections(4)
        .connect_with(options)
        .await?;

    MIGRATOR.run(&pool).await.map_err(sqlx::Error::from)?;
    let schema_version: i64 = sqlx::query_scalar("PRAGMA user_version")
        .fetch_one(&pool)
        .await?;
    diagnostics::info(
        "database_ready",
        serde_json::json!({
            "schemaVersion": schema_version,
            "databasePath": database_path.to_string_lossy(),
        }),
    );
    Ok(pool)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn migrations_create_current_core_tables() {
        let directory = tempfile::tempdir().expect("temp dir");
        let pool = connect(directory.path()).await.expect("database connects");
        let names: Vec<String> = sqlx::query_scalar(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '_sqlx%' ORDER BY name",
        )
        .fetch_all(&pool)
        .await
        .expect("table names");

        assert_eq!(
            names,
            vec![
                "documents",
                "favorite_tags",
                "favorites",
                "reading_progress",
                "settings",
                "tags"
            ]
        );
    }
}
