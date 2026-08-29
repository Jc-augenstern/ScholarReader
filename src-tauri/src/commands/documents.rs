use sha2::{Digest, Sha256};
use sqlx::SqlitePool;
use std::{
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::State;
use tokio::{fs::File, io::AsyncReadExt};
use uuid::Uuid;
use walkdir::WalkDir;

use crate::{
    database::AppState,
    error::AppError,
    models::{Document, ImportIssue, ImportSummary, RebindCandidate},
};

const DOCUMENT_COLUMNS: &str = r#"
    id, title, filename, filepath, file_hash, file_size,
    page_count,
    (SELECT rp.page_number FROM reading_progress rp WHERE rp.document_id = documents.id) AS reading_page,
    is_starred, created_at, last_opened_at, updated_at
"#;

#[tauri::command]
pub async fn list_documents(state: State<'_, AppState>) -> Result<Vec<Document>, AppError> {
    let query = format!(
        "SELECT {DOCUMENT_COLUMNS} FROM documents ORDER BY COALESCE(last_opened_at, created_at) DESC"
    );
    Ok(sqlx::query_as::<_, Document>(&query)
        .fetch_all(&state.pool)
        .await?)
}

#[tauri::command]
pub async fn get_document(id: String, state: State<'_, AppState>) -> Result<Document, AppError> {
    fetch_document(&state.pool, &id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("document {id}")))
}

#[tauri::command]
pub async fn import_documents(
    paths: Vec<String>,
    state: State<'_, AppState>,
) -> Result<ImportSummary, AppError> {
    if paths.is_empty() {
        return Err(AppError::InvalidInput(
            "at least one PDF path is required".into(),
        ));
    }

    import_paths(&state.pool, paths).await
}

#[tauri::command]
pub async fn import_pdf_folder(
    path: String,
    recursive: bool,
    state: State<'_, AppState>,
) -> Result<ImportSummary, AppError> {
    let canonical = dunce::canonicalize(&path)?;
    if !canonical.is_dir() {
        return Err(AppError::InvalidInput(
            "selected path is not a folder".into(),
        ));
    }
    let paths = tauri::async_runtime::spawn_blocking(move || {
        let mut walker = WalkDir::new(canonical).follow_links(false);
        if !recursive {
            walker = walker.max_depth(1);
        }
        walker
            .into_iter()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_type().is_file())
            .filter(|entry| {
                entry
                    .path()
                    .extension()
                    .and_then(|value| value.to_str())
                    .is_some_and(|value| value.eq_ignore_ascii_case("pdf"))
            })
            .map(|entry| entry.path().to_string_lossy().into_owned())
            .collect::<Vec<_>>()
    })
    .await
    .map_err(|error| AppError::Platform(error.to_string()))?;
    if paths.is_empty() {
        return Err(AppError::InvalidInput(
            "the selected folder contains no PDF files".into(),
        ));
    }
    import_paths(&state.pool, paths).await
}

async fn import_paths(pool: &SqlitePool, paths: Vec<String>) -> Result<ImportSummary, AppError> {
    let mut summary = ImportSummary {
        imported: Vec::new(),
        duplicates: Vec::new(),
        failed: Vec::new(),
    };

    for source_path in paths {
        match import_one(pool, &source_path).await {
            Ok(ImportOneResult::Imported(document)) => summary.imported.push(document),
            Ok(ImportOneResult::Duplicate(issue)) => summary.duplicates.push(issue),
            Err(error) => summary.failed.push(ImportIssue {
                path: source_path,
                code: "import_failed".into(),
                message: error.to_string(),
                existing_document_id: None,
            }),
        }
    }

    Ok(summary)
}

#[tauri::command]
pub async fn remove_document(id: String, state: State<'_, AppState>) -> Result<bool, AppError> {
    let result = sqlx::query("DELETE FROM documents WHERE id = ?")
        .bind(id)
        .execute(&state.pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

#[tauri::command]
pub async fn rename_document(
    id: String,
    title: String,
    state: State<'_, AppState>,
) -> Result<Document, AppError> {
    let title = title.trim();
    if title.is_empty() {
        return Err(AppError::InvalidInput("title cannot be empty".into()));
    }
    let result = sqlx::query("UPDATE documents SET title = ?, updated_at = ? WHERE id = ?")
        .bind(title)
        .bind(now_ms())
        .bind(&id)
        .execute(&state.pool)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("document {id}")));
    }
    fetch_document(&state.pool, &id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("document {id}")))
}

#[tauri::command]
pub async fn set_document_starred(
    id: String,
    starred: bool,
    state: State<'_, AppState>,
) -> Result<Document, AppError> {
    let result = sqlx::query("UPDATE documents SET is_starred = ?, updated_at = ? WHERE id = ?")
        .bind(starred)
        .bind(now_ms())
        .bind(&id)
        .execute(&state.pool)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("document {id}")));
    }
    fetch_document(&state.pool, &id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("document {id}")))
}

#[tauri::command]
pub async fn read_document_bytes(
    id: String,
    state: State<'_, AppState>,
) -> Result<tauri::ipc::Response, AppError> {
    let document = fetch_document(&state.pool, &id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("document {id}")))?;
    let path = Path::new(&document.filepath);
    if !path.is_file() {
        return Err(AppError::FileMissing(document.filepath));
    }

    let bytes = tokio::fs::read(path).await?;
    let metadata = tokio::fs::metadata(path).await?;
    let current_hash = hex::encode(Sha256::digest(&bytes));
    let current_size = i64::try_from(metadata.len())
        .map_err(|_| AppError::InvalidInput("file is too large".into()))?;
    let source_modified_at = metadata.modified().ok().and_then(system_time_ms);
    let timestamp = now_ms();
    sqlx::query(
        "UPDATE documents SET file_hash = ?, file_size = ?, source_modified_at = ?, last_opened_at = ?, updated_at = ? WHERE id = ?",
    )
        .bind(current_hash)
        .bind(current_size)
        .bind(source_modified_at)
        .bind(timestamp)
        .bind(timestamp)
        .bind(&id)
        .execute(&state.pool)
        .await?;

    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub async fn set_document_page_count(
    id: String,
    page_count: i64,
    state: State<'_, AppState>,
) -> Result<Document, AppError> {
    if page_count <= 0 {
        return Err(AppError::InvalidInput(
            "page count must be greater than zero".into(),
        ));
    }
    let result = sqlx::query("UPDATE documents SET page_count = ?, updated_at = ? WHERE id = ?")
        .bind(page_count)
        .bind(now_ms())
        .bind(&id)
        .execute(&state.pool)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("document {id}")));
    }
    fetch_document(&state.pool, &id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("document {id}")))
}

#[tauri::command]
pub async fn check_rebind_candidate(
    id: String,
    path: String,
    state: State<'_, AppState>,
) -> Result<RebindCandidate, AppError> {
    let document = fetch_document(&state.pool, &id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("document {id}")))?;
    inspect_candidate(&document, &path).await
}

#[tauri::command]
pub async fn rebind_document(
    id: String,
    path: String,
    allow_changed: bool,
    state: State<'_, AppState>,
) -> Result<Document, AppError> {
    let document = fetch_document(&state.pool, &id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("document {id}")))?;
    let candidate = inspect_candidate(&document, &path).await?;
    if !candidate.hash_matches && !allow_changed {
        return Err(AppError::InvalidInput(
            "the selected PDF hash differs from the original file".into(),
        ));
    }
    let canonical = dunce::canonicalize(&candidate.path)?;
    let metadata = tokio::fs::metadata(&canonical).await?;
    let modified_at = metadata.modified().ok().and_then(system_time_ms);
    sqlx::query(
        r#"
        UPDATE documents SET
          filename = ?, filepath = ?, path_key = ?, file_hash = ?, file_size = ?,
          source_modified_at = ?, updated_at = ?
        WHERE id = ?
        "#,
    )
    .bind(&candidate.filename)
    .bind(&candidate.path)
    .bind(normalize_path_key(&canonical))
    .bind(&candidate.file_hash)
    .bind(candidate.file_size)
    .bind(modified_at)
    .bind(now_ms())
    .bind(&id)
    .execute(&state.pool)
    .await?;
    fetch_document(&state.pool, &id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("document {id}")))
}

async fn inspect_candidate(
    document: &Document,
    source_path: &str,
) -> Result<RebindCandidate, AppError> {
    let canonical = dunce::canonicalize(source_path)?;
    ensure_pdf(&canonical)?;
    let metadata = tokio::fs::metadata(&canonical).await?;
    if !metadata.is_file() {
        return Err(AppError::InvalidInput("selected path is not a file".into()));
    }
    let filename = canonical
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| AppError::InvalidInput("file name is not valid Unicode".into()))?
        .to_owned();
    let file_size = i64::try_from(metadata.len())
        .map_err(|_| AppError::InvalidInput("file is too large".into()))?;
    let file_hash = hash_file(&canonical).await?;
    Ok(RebindCandidate {
        path: canonical.to_string_lossy().into_owned(),
        filename_matches: filename.eq_ignore_ascii_case(&document.filename),
        size_matches: file_size == document.file_size,
        hash_matches: file_hash == document.file_hash,
        filename,
        file_size,
        file_hash,
    })
}

enum ImportOneResult {
    Imported(Document),
    Duplicate(ImportIssue),
}

async fn import_one(pool: &SqlitePool, source_path: &str) -> Result<ImportOneResult, AppError> {
    let canonical = dunce::canonicalize(source_path)?;
    ensure_pdf(&canonical)?;
    let metadata = tokio::fs::metadata(&canonical).await?;
    if !metadata.is_file() {
        return Err(AppError::InvalidInput("selected path is not a file".into()));
    }

    let display_path = canonical.to_string_lossy().into_owned();
    let path_key = normalize_path_key(&canonical);
    if let Some(existing) = find_by_path_key(pool, &path_key).await? {
        return Ok(ImportOneResult::Duplicate(ImportIssue {
            path: display_path,
            code: "same_path".into(),
            message: "This PDF is already in the library.".into(),
            existing_document_id: Some(existing.id),
        }));
    }

    let file_hash = hash_file(&canonical).await?;
    let file_size = i64::try_from(metadata.len())
        .map_err(|_| AppError::InvalidInput("file is too large".into()))?;
    if let Some(existing) = find_by_hash(pool, &file_hash, file_size).await? {
        return Ok(ImportOneResult::Duplicate(ImportIssue {
            path: display_path,
            code: "same_content".into(),
            message: "An identical PDF is already in the library.".into(),
            existing_document_id: Some(existing.id),
        }));
    }

    let filename = canonical
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| AppError::InvalidInput("file name is not valid Unicode".into()))?
        .to_owned();
    let title = canonical
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(&filename)
        .to_owned();
    let id = Uuid::new_v4().to_string();
    let timestamp = now_ms();
    let source_modified_at = metadata.modified().ok().and_then(system_time_ms);

    sqlx::query(
        r#"
        INSERT INTO documents (
            id, title, filename, filepath, path_key, file_hash, file_size,
            source_modified_at, page_count, is_starred, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?)
        "#,
    )
    .bind(&id)
    .bind(title)
    .bind(filename)
    .bind(display_path)
    .bind(path_key)
    .bind(file_hash)
    .bind(file_size)
    .bind(source_modified_at)
    .bind(timestamp)
    .bind(timestamp)
    .execute(pool)
    .await?;

    let document = fetch_document(pool, &id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("document {id}")))?;
    Ok(ImportOneResult::Imported(document))
}

async fn fetch_document(pool: &SqlitePool, id: &str) -> Result<Option<Document>, AppError> {
    let query = format!("SELECT {DOCUMENT_COLUMNS} FROM documents WHERE id = ?");
    Ok(sqlx::query_as::<_, Document>(&query)
        .bind(id)
        .fetch_optional(pool)
        .await?)
}

async fn find_by_path_key(pool: &SqlitePool, path_key: &str) -> Result<Option<Document>, AppError> {
    let query = format!("SELECT {DOCUMENT_COLUMNS} FROM documents WHERE path_key = ?");
    Ok(sqlx::query_as::<_, Document>(&query)
        .bind(path_key)
        .fetch_optional(pool)
        .await?)
}

async fn find_by_hash(
    pool: &SqlitePool,
    file_hash: &str,
    file_size: i64,
) -> Result<Option<Document>, AppError> {
    let query = format!(
        "SELECT {DOCUMENT_COLUMNS} FROM documents WHERE file_hash = ? AND file_size = ? LIMIT 1"
    );
    Ok(sqlx::query_as::<_, Document>(&query)
        .bind(file_hash)
        .bind(file_size)
        .fetch_optional(pool)
        .await?)
}

fn ensure_pdf(path: &Path) -> Result<(), AppError> {
    let is_pdf = path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("pdf"));
    if is_pdf {
        Ok(())
    } else {
        Err(AppError::InvalidInput(
            "only PDF files can be imported".into(),
        ))
    }
}

pub(crate) async fn hash_file(path: &Path) -> Result<String, AppError> {
    let mut file = File::open(path).await?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 1024 * 1024];
    loop {
        let bytes_read = file.read(&mut buffer).await?;
        if bytes_read == 0 {
            break;
        }
        hasher.update(&buffer[..bytes_read]);
    }
    Ok(hex::encode(hasher.finalize()))
}

pub(crate) fn normalize_path_key(path: &Path) -> String {
    let normalized = path.to_string_lossy().replace('/', "\\");
    if cfg!(windows) {
        normalized.to_lowercase()
    } else {
        normalized
    }
}

fn now_ms() -> i64 {
    system_time_ms(SystemTime::now()).unwrap_or_default()
}

fn system_time_ms(value: SystemTime) -> Option<i64> {
    value
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| i64::try_from(duration.as_millis()).ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_pdf_extension_case_insensitively() {
        assert!(ensure_pdf(Path::new("paper.PDF")).is_ok());
        assert!(ensure_pdf(Path::new("notes.txt")).is_err());
    }

    #[test]
    fn path_keys_use_windows_style_separators() {
        let key = normalize_path_key(Path::new("D:/Papers/Study.pdf"));
        assert!(key.contains('\\'));
    }

    #[tokio::test]
    async fn imports_a_pdf_and_detects_the_duplicate_path() {
        let directory = tempfile::tempdir().expect("temp dir");
        let pool = crate::database::connect(directory.path())
            .await
            .expect("database connects");
        let pdf_path = directory.path().join("reader-fixture.pdf");
        tokio::fs::write(&pdf_path, b"%PDF-1.4\n% integration fixture")
            .await
            .expect("fixture is written");

        let first = import_one(&pool, &pdf_path.to_string_lossy())
            .await
            .expect("first import succeeds");
        assert!(matches!(first, ImportOneResult::Imported(_)));

        let second = import_one(&pool, &pdf_path.to_string_lossy())
            .await
            .expect("duplicate check succeeds");
        match second {
            ImportOneResult::Duplicate(issue) => assert_eq!(issue.code, "same_path"),
            ImportOneResult::Imported(_) => panic!("duplicate path must not be imported twice"),
        }
    }

    #[tokio::test]
    async fn multiple_imported_pdfs_survive_database_restart() {
        let directory = tempfile::tempdir().expect("temp dir");
        let pool = crate::database::connect(directory.path())
            .await
            .expect("database connects");
        let first_path = directory.path().join("first-paper.pdf");
        let second_path = directory.path().join("second-paper.pdf");
        tokio::fs::write(&first_path, b"%PDF-1.4 first integration fixture")
            .await
            .expect("first fixture is written");
        tokio::fs::write(&second_path, b"%PDF-1.4 second integration fixture")
            .await
            .expect("second fixture is written");

        import_one(&pool, &first_path.to_string_lossy())
            .await
            .expect("first import succeeds");
        import_one(&pool, &second_path.to_string_lossy())
            .await
            .expect("second import succeeds");
        pool.close().await;

        let reopened = crate::database::connect(directory.path())
            .await
            .expect("database reconnects");
        let titles: Vec<String> = sqlx::query_scalar("SELECT title FROM documents ORDER BY title")
            .fetch_all(&reopened)
            .await
            .expect("persisted documents load");

        assert_eq!(titles, vec!["first-paper", "second-paper"]);
    }

    #[tokio::test]
    async fn rebind_candidate_detects_a_changed_pdf() {
        let directory = tempfile::tempdir().expect("temp dir");
        let path = directory.path().join("paper.pdf");
        tokio::fs::write(&path, b"%PDF-1.4 original")
            .await
            .expect("fixture writes");
        let original_hash = hash_file(&path).await.expect("hash");
        let document = Document {
            id: "doc".into(),
            title: "Paper".into(),
            filename: "paper.pdf".into(),
            filepath: path.to_string_lossy().into_owned(),
            file_hash: original_hash,
            file_size: 17,
            page_count: Some(1),
            reading_page: None,
            is_starred: false,
            created_at: 0,
            last_opened_at: None,
            updated_at: 0,
        };
        tokio::fs::write(&path, b"%PDF-1.4 content changed")
            .await
            .expect("fixture changes");
        let candidate = inspect_candidate(&document, path.to_str().expect("UTF-8 path"))
            .await
            .expect("candidate inspects");
        assert!(candidate.filename_matches);
        assert!(!candidate.size_matches);
        assert!(!candidate.hash_matches);
    }
}
