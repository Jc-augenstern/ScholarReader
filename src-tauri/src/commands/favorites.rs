use serde_json::Value;
use sqlx::{FromRow, Sqlite, SqlitePool, Transaction};
use std::{
    collections::HashSet,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::State;
use uuid::Uuid;

use crate::{
    database::AppState,
    error::AppError,
    models::{CreateFavoriteInput, Favorite, Tag, TagSummary, UpdateFavoriteInput},
};

#[derive(Debug, FromRow)]
struct FavoriteRow {
    id: String,
    document_id: String,
    selected_text: String,
    normalized_text: String,
    page_number: i64,
    text_start_index: Option<i64>,
    text_end_index: Option<i64>,
    context_before: String,
    context_after: String,
    selection_rects_json: String,
    document_hash: String,
    locator_version: i64,
    note: String,
    created_at: i64,
    updated_at: i64,
    document_title: String,
    filename: String,
    filepath: String,
}

const FAVORITE_SELECT: &str = r#"
    SELECT
      f.id, f.document_id, f.selected_text, f.normalized_text,
      f.page_number, f.text_start_index, f.text_end_index,
      f.context_before, f.context_after, f.selection_rects_json,
      f.document_hash, f.locator_version, f.note, f.created_at, f.updated_at,
      d.title AS document_title, d.filename, d.filepath
    FROM favorites f
    JOIN documents d ON d.id = f.document_id
"#;

#[tauri::command]
pub async fn list_favorites(
    query: Option<String>,
    document_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<Favorite>, AppError> {
    let query = query
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty());
    let pattern = query.as_ref().map(|value| format!("%{value}%"));
    let sql = format!(
        r#"
        {FAVORITE_SELECT}
        WHERE (? IS NULL OR f.document_id = ?)
          AND (? IS NULL OR
            lower(f.selected_text) LIKE ? OR lower(f.note) LIKE ? OR
            lower(d.title) LIKE ? OR lower(d.filename) LIKE ? OR
            EXISTS (
              SELECT 1 FROM favorite_tags ft
              JOIN tags t ON t.id = ft.tag_id
              WHERE ft.favorite_id = f.id AND lower(t.name) LIKE ?
            )
          )
        ORDER BY f.created_at DESC
        "#,
    );
    let rows = sqlx::query_as::<_, FavoriteRow>(&sql)
        .bind(document_id.as_deref())
        .bind(document_id.as_deref())
        .bind(pattern.as_deref())
        .bind(pattern.as_deref())
        .bind(pattern.as_deref())
        .bind(pattern.as_deref())
        .bind(pattern.as_deref())
        .bind(pattern.as_deref())
        .fetch_all(&state.pool)
        .await?;
    hydrate_favorites(&state.pool, rows).await
}

#[tauri::command]
pub async fn get_favorite(id: String, state: State<'_, AppState>) -> Result<Favorite, AppError> {
    fetch_favorite(&state.pool, &id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("favorite {id}")))
}

#[tauri::command]
pub async fn create_favorite(
    input: CreateFavoriteInput,
    state: State<'_, AppState>,
) -> Result<Favorite, AppError> {
    validate_create_input(&input)?;
    let document_hash: Option<String> =
        sqlx::query_scalar("SELECT file_hash FROM documents WHERE id = ?")
            .bind(&input.document_id)
            .fetch_optional(&state.pool)
            .await?;
    let document_hash = document_hash
        .ok_or_else(|| AppError::NotFound(format!("document {}", input.document_id)))?;
    let id = Uuid::new_v4().to_string();
    let timestamp = now_ms();
    sqlx::query(
        r#"
        INSERT INTO favorites (
          id, document_id, selected_text, normalized_text, page_number,
          text_start_index, text_end_index, context_before, context_after,
          selection_rects_json, document_hash, locator_version, note,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, '', ?, ?)
        "#,
    )
    .bind(&id)
    .bind(&input.document_id)
    .bind(input.selected_text.trim())
    .bind(&input.normalized_text)
    .bind(input.page_number)
    .bind(input.text_start_index)
    .bind(input.text_end_index)
    .bind(&input.context_before)
    .bind(&input.context_after)
    .bind(&input.selection_rects_json)
    .bind(document_hash)
    .bind(timestamp)
    .bind(timestamp)
    .execute(&state.pool)
    .await?;
    fetch_favorite(&state.pool, &id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("favorite {id}")))
}

#[tauri::command]
pub async fn update_favorite(
    input: UpdateFavoriteInput,
    state: State<'_, AppState>,
) -> Result<Favorite, AppError> {
    let mut transaction = state.pool.begin().await?;
    let result = sqlx::query("UPDATE favorites SET note = ?, updated_at = ? WHERE id = ?")
        .bind(input.note.trim())
        .bind(now_ms())
        .bind(&input.id)
        .execute(&mut *transaction)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("favorite {}", input.id)));
    }
    replace_tags(&mut transaction, &input.id, &input.tag_names).await?;
    transaction.commit().await?;
    fetch_favorite(&state.pool, &input.id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("favorite {}", input.id)))
}

#[tauri::command]
pub async fn delete_favorite(id: String, state: State<'_, AppState>) -> Result<bool, AppError> {
    let result = sqlx::query("DELETE FROM favorites WHERE id = ?")
        .bind(id)
        .execute(&state.pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

#[tauri::command]
pub async fn list_tags(state: State<'_, AppState>) -> Result<Vec<TagSummary>, AppError> {
    Ok(sqlx::query_as::<_, TagSummary>(
        r#"
        SELECT t.id, t.name, t.created_at, count(ft.favorite_id) AS favorite_count
        FROM tags t
        LEFT JOIN favorite_tags ft ON ft.tag_id = t.id
        GROUP BY t.id
        ORDER BY lower(t.name)
        "#,
    )
    .fetch_all(&state.pool)
    .await?)
}

#[tauri::command]
pub async fn rename_tag(
    id: String,
    name: String,
    state: State<'_, AppState>,
) -> Result<TagSummary, AppError> {
    let (name, normalized) = normalize_tag_name(&name)?;
    let result = sqlx::query("UPDATE tags SET name = ?, normalized_name = ? WHERE id = ?")
        .bind(name)
        .bind(normalized)
        .bind(&id)
        .execute(&state.pool)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("tag {id}")));
    }
    fetch_tag_summary(&state.pool, &id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("tag {id}")))
}

#[tauri::command]
pub async fn delete_tag(id: String, state: State<'_, AppState>) -> Result<bool, AppError> {
    let result = sqlx::query("DELETE FROM tags WHERE id = ?")
        .bind(id)
        .execute(&state.pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

#[tauri::command]
pub async fn merge_tags(
    source_id: String,
    target_id: String,
    state: State<'_, AppState>,
) -> Result<bool, AppError> {
    if source_id == target_id {
        return Err(AppError::InvalidInput(
            "source and target tags must differ".into(),
        ));
    }
    let mut transaction = state.pool.begin().await?;
    sqlx::query(
        r#"
        INSERT OR IGNORE INTO favorite_tags (favorite_id, tag_id)
        SELECT favorite_id, ? FROM favorite_tags WHERE tag_id = ?
        "#,
    )
    .bind(&target_id)
    .bind(&source_id)
    .execute(&mut *transaction)
    .await?;
    let result = sqlx::query("DELETE FROM tags WHERE id = ?")
        .bind(source_id)
        .execute(&mut *transaction)
        .await?;
    transaction.commit().await?;
    Ok(result.rows_affected() > 0)
}

async fn fetch_favorite(pool: &SqlitePool, id: &str) -> Result<Option<Favorite>, AppError> {
    let sql = format!("{FAVORITE_SELECT} WHERE f.id = ?");
    let row = sqlx::query_as::<_, FavoriteRow>(&sql)
        .bind(id)
        .fetch_optional(pool)
        .await?;
    match row {
        Some(row) => Ok(hydrate_favorites(pool, vec![row]).await?.pop()),
        None => Ok(None),
    }
}

async fn hydrate_favorites(
    pool: &SqlitePool,
    rows: Vec<FavoriteRow>,
) -> Result<Vec<Favorite>, AppError> {
    let mut result = Vec::with_capacity(rows.len());
    for row in rows {
        let tags = sqlx::query_as::<_, Tag>(
            r#"
            SELECT t.id, t.name, t.created_at
            FROM tags t
            JOIN favorite_tags ft ON ft.tag_id = t.id
            WHERE ft.favorite_id = ?
            ORDER BY lower(t.name)
            "#,
        )
        .bind(&row.id)
        .fetch_all(pool)
        .await?;
        result.push(Favorite {
            id: row.id,
            document_id: row.document_id,
            selected_text: row.selected_text,
            normalized_text: row.normalized_text,
            page_number: row.page_number,
            text_start_index: row.text_start_index,
            text_end_index: row.text_end_index,
            context_before: row.context_before,
            context_after: row.context_after,
            selection_rects_json: row.selection_rects_json,
            document_hash: row.document_hash,
            locator_version: row.locator_version,
            note: row.note,
            created_at: row.created_at,
            updated_at: row.updated_at,
            document_title: row.document_title,
            filename: row.filename,
            filepath: row.filepath,
            tags,
        });
    }
    Ok(result)
}

async fn replace_tags(
    transaction: &mut Transaction<'_, Sqlite>,
    favorite_id: &str,
    names: &[String],
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM favorite_tags WHERE favorite_id = ?")
        .bind(favorite_id)
        .execute(&mut **transaction)
        .await?;
    let mut seen = HashSet::new();
    for raw_name in names {
        let (name, normalized) = normalize_tag_name(raw_name)?;
        if !seen.insert(normalized.clone()) {
            continue;
        }
        sqlx::query(
            "INSERT OR IGNORE INTO tags (id, name, normalized_name, created_at) VALUES (?, ?, ?, ?)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&name)
        .bind(&normalized)
        .bind(now_ms())
        .execute(&mut **transaction)
        .await?;
        let tag_id: String = sqlx::query_scalar("SELECT id FROM tags WHERE normalized_name = ?")
            .bind(normalized)
            .fetch_one(&mut **transaction)
            .await?;
        sqlx::query("INSERT INTO favorite_tags (favorite_id, tag_id) VALUES (?, ?)")
            .bind(favorite_id)
            .bind(tag_id)
            .execute(&mut **transaction)
            .await?;
    }
    Ok(())
}

fn validate_create_input(input: &CreateFavoriteInput) -> Result<(), AppError> {
    if input.document_id.trim().is_empty()
        || input.selected_text.trim().is_empty()
        || input.normalized_text.trim().is_empty()
        || input.page_number <= 0
    {
        return Err(AppError::InvalidInput(
            "favorite selection is incomplete".into(),
        ));
    }
    if matches!((input.text_start_index, input.text_end_index), (Some(start), Some(end)) if end < start)
    {
        return Err(AppError::InvalidInput(
            "favorite text indexes are invalid".into(),
        ));
    }
    let rects: Value = serde_json::from_str(&input.selection_rects_json)
        .map_err(|_| AppError::InvalidInput("selection rectangles are not valid JSON".into()))?;
    if !rects.is_array() {
        return Err(AppError::InvalidInput(
            "selection rectangles must be an array".into(),
        ));
    }
    Ok(())
}

fn normalize_tag_name(value: &str) -> Result<(String, String), AppError> {
    let name = value.trim().trim_start_matches('#').trim();
    if name.is_empty() {
        return Err(AppError::InvalidInput("tag name cannot be empty".into()));
    }
    if name.chars().count() > 40 {
        return Err(AppError::InvalidInput("tag name is too long".into()));
    }
    Ok((name.to_owned(), name.to_lowercase()))
}

async fn fetch_tag_summary(pool: &SqlitePool, id: &str) -> Result<Option<TagSummary>, AppError> {
    Ok(sqlx::query_as::<_, TagSummary>(
        r#"
        SELECT t.id, t.name, t.created_at, count(ft.favorite_id) AS favorite_count
        FROM tags t LEFT JOIN favorite_tags ft ON ft.tag_id = t.id
        WHERE t.id = ? GROUP BY t.id
        "#,
    )
    .bind(id)
    .fetch_optional(pool)
    .await?)
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
    fn validates_rect_json_and_tag_names() {
        let input = CreateFavoriteInput {
            document_id: "doc".into(),
            selected_text: "Recognition rather than recall.".into(),
            normalized_text: "Recognition rather than recall.".into(),
            page_number: 42,
            text_start_index: Some(10),
            text_end_index: Some(45),
            context_before: String::new(),
            context_after: String::new(),
            selection_rects_json: "[]".into(),
        };
        assert!(validate_create_input(&input).is_ok());
        assert_eq!(
            normalize_tag_name(" #HCI ").unwrap(),
            ("HCI".into(), "hci".into())
        );
    }

    #[tokio::test]
    async fn favorite_and_tags_round_trip() {
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
            ) VALUES ('doc-1', 'HCI', 'hci.pdf', 'D:\\hci.pdf',
                      'd:\\hci.pdf', ?, 10, 0, ?, ?)
            "#,
        )
        .bind("a".repeat(64))
        .bind(timestamp)
        .bind(timestamp)
        .execute(&pool)
        .await
        .expect("document row");
        sqlx::query(
            r#"
            INSERT INTO favorites (
              id, document_id, selected_text, normalized_text, page_number,
              selection_rects_json, document_hash, created_at, updated_at
            ) VALUES ('fav-1', 'doc-1', 'Recognition rather than recall.',
                      'Recognition rather than recall.', 42, '[]', ?, ?, ?)
            "#,
        )
        .bind("a".repeat(64))
        .bind(timestamp)
        .bind(timestamp)
        .execute(&pool)
        .await
        .expect("favorite row");

        let mut transaction = pool.begin().await.expect("transaction");
        replace_tags(
            &mut transaction,
            "fav-1",
            &["HCI".into(), "考试重点".into(), "hci".into()],
        )
        .await
        .expect("tags attach");
        transaction.commit().await.expect("commit");

        let favorite = fetch_favorite(&pool, "fav-1")
            .await
            .expect("favorite reads")
            .expect("favorite exists");
        assert_eq!(favorite.document_title, "HCI");
        assert_eq!(favorite.tags.len(), 2);
    }
}
