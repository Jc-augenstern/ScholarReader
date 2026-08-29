use sqlx::SqlitePool;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

use crate::{database::AppState, error::AppError, models::ReadingProgress};

const PROGRESS_COLUMNS: &str = r#"
    document_id, page_number, page_offset_ratio, zoom_mode,
    zoom_value, rotation, updated_at
"#;

#[tauri::command]
pub async fn get_reading_progress(
    document_id: String,
    state: State<'_, AppState>,
) -> Result<Option<ReadingProgress>, AppError> {
    fetch_progress(&state.pool, &document_id).await
}

#[tauri::command]
pub async fn save_reading_progress(
    document_id: String,
    page_number: i64,
    page_offset_ratio: f64,
    zoom_mode: String,
    zoom_value: f64,
    rotation: i64,
    state: State<'_, AppState>,
) -> Result<ReadingProgress, AppError> {
    validate_progress(
        page_number,
        page_offset_ratio,
        &zoom_mode,
        zoom_value,
        rotation,
    )?;
    persist_progress(
        &state.pool,
        &document_id,
        page_number,
        page_offset_ratio,
        &zoom_mode,
        zoom_value,
        rotation,
    )
    .await
}

async fn persist_progress(
    pool: &SqlitePool,
    document_id: &str,
    page_number: i64,
    page_offset_ratio: f64,
    zoom_mode: &str,
    zoom_value: f64,
    rotation: i64,
) -> Result<ReadingProgress, AppError> {
    let timestamp = now_ms();
    let mut transaction = pool.begin().await?;
    sqlx::query(
        r#"
        INSERT INTO reading_progress (
            document_id, page_number, page_offset_ratio, zoom_mode,
            zoom_value, rotation, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(document_id) DO UPDATE SET
            page_number = excluded.page_number,
            page_offset_ratio = excluded.page_offset_ratio,
            zoom_mode = excluded.zoom_mode,
            zoom_value = excluded.zoom_value,
            rotation = excluded.rotation,
            updated_at = excluded.updated_at
        "#,
    )
    .bind(document_id)
    .bind(page_number)
    .bind(page_offset_ratio)
    .bind(zoom_mode)
    .bind(zoom_value)
    .bind(rotation)
    .bind(timestamp)
    .execute(&mut *transaction)
    .await?;
    sqlx::query("UPDATE documents SET last_opened_at = ?, updated_at = ? WHERE id = ?")
        .bind(timestamp)
        .bind(timestamp)
        .bind(document_id)
        .execute(&mut *transaction)
        .await?;
    transaction.commit().await?;

    fetch_progress(pool, document_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("reading progress for {document_id}")))
}

async fn fetch_progress(
    pool: &SqlitePool,
    document_id: &str,
) -> Result<Option<ReadingProgress>, AppError> {
    let query = format!("SELECT {PROGRESS_COLUMNS} FROM reading_progress WHERE document_id = ?");
    Ok(sqlx::query_as::<_, ReadingProgress>(&query)
        .bind(document_id)
        .fetch_optional(pool)
        .await?)
}

fn validate_progress(
    page_number: i64,
    page_offset_ratio: f64,
    zoom_mode: &str,
    zoom_value: f64,
    rotation: i64,
) -> Result<(), AppError> {
    if page_number <= 0 {
        return Err(AppError::InvalidInput(
            "page number must be positive".into(),
        ));
    }
    if !(0.0..=1.0).contains(&page_offset_ratio) {
        return Err(AppError::InvalidInput(
            "page offset ratio must be between zero and one".into(),
        ));
    }
    if !matches!(zoom_mode, "custom" | "fit-page" | "fit-width") {
        return Err(AppError::InvalidInput("unsupported zoom mode".into()));
    }
    if !zoom_value.is_finite() || zoom_value <= 0.0 {
        return Err(AppError::InvalidInput("zoom value must be positive".into()));
    }
    if !matches!(rotation, 0 | 90 | 180 | 270) {
        return Err(AppError::InvalidInput("unsupported rotation".into()));
    }
    Ok(())
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| i64::try_from(duration.as_millis()).ok())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn progress_validation_rejects_invalid_values() {
        assert!(validate_progress(0, 0.0, "fit-width", 1.0, 0).is_err());
        assert!(validate_progress(1, 1.1, "fit-width", 1.0, 0).is_err());
        assert!(validate_progress(1, 0.0, "unknown", 1.0, 0).is_err());
        assert!(validate_progress(1, 0.0, "custom", 0.0, 0).is_err());
        assert!(validate_progress(1, 0.0, "custom", 1.0, 45).is_err());
        assert!(validate_progress(42, 0.5, "fit-page", 1.25, 90).is_ok());
    }

    #[tokio::test]
    async fn reading_progress_round_trips_through_sqlite() {
        let directory = tempfile::tempdir().expect("temp dir");
        let pool = crate::database::connect(directory.path())
            .await
            .expect("database connects");
        let timestamp = now_ms();
        sqlx::query(
            r#"
            INSERT INTO documents (
                id, title, filename, filepath, path_key, file_hash,
                file_size, is_starred, created_at, updated_at
            ) VALUES ('doc-1', 'Reader', 'reader.pdf', 'D:\\reader.pdf',
                      'd:\\reader.pdf', ?, 10, 0, ?, ?)
            "#,
        )
        .bind("0".repeat(64))
        .bind(timestamp)
        .bind(timestamp)
        .execute(&pool)
        .await
        .expect("document row");

        let saved = persist_progress(&pool, "doc-1", 42, 0.35, "custom", 1.4, 90)
            .await
            .expect("progress saves");
        assert_eq!(saved.page_number, 42);
        assert_eq!(saved.zoom_mode, "custom");

        let restored = fetch_progress(&pool, "doc-1")
            .await
            .expect("progress reads")
            .expect("progress exists");
        assert_eq!(restored.rotation, 90);
        assert!((restored.zoom_value - 1.4).abs() < f64::EPSILON);
    }
}
