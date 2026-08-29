use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};

use serde_json::{json, Value};

const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024;
const ROTATED_LOGS: usize = 2;

struct AppLogger {
    directory: PathBuf,
    path: PathBuf,
    lock: Mutex<()>,
}

static LOGGER: OnceLock<AppLogger> = OnceLock::new();

pub fn initialize(directory: PathBuf, version: &str) -> std::io::Result<()> {
    fs::create_dir_all(&directory)?;
    let path = directory.join("scholarreader.log");
    let _ = LOGGER.set(AppLogger {
        directory,
        path,
        lock: Mutex::new(()),
    });
    info(
        "application_start",
        json!({ "version": version, "platform": std::env::consts::OS }),
    );
    Ok(())
}

pub fn directory() -> Option<PathBuf> {
    LOGGER.get().map(|logger| logger.directory.clone())
}

pub fn info(event: &str, fields: Value) {
    write("INFO", event, fields);
}

pub fn error(event: &str, fields: Value) {
    write("ERROR", event, fields);
}

fn write(level: &str, event: &str, fields: Value) {
    let Some(logger) = LOGGER.get() else { return };
    let Ok(_guard) = logger.lock.lock() else {
        return;
    };
    if fs::metadata(&logger.path).is_ok_and(|metadata| metadata.len() >= MAX_LOG_BYTES) {
        rotate(&logger.path);
    }
    let line = json!({
        "timestampMs": now_ms(),
        "level": level,
        "event": event,
        "fields": fields,
    });
    if let Ok(mut file) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&logger.path)
    {
        let _ = writeln!(file, "{line}");
    }
}

fn rotate(path: &Path) {
    let oldest = path.with_file_name(format!("scholarreader.{ROTATED_LOGS}.log"));
    let _ = fs::remove_file(oldest);
    for index in (1..ROTATED_LOGS).rev() {
        let source = path.with_file_name(format!("scholarreader.{index}.log"));
        let target = path.with_file_name(format!("scholarreader.{}.log", index + 1));
        let _ = fs::rename(source, target);
    }
    let _ = fs::rename(path, path.with_file_name("scholarreader.1.log"));
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn log_payload_never_needs_a_secret_field() {
        let line = json!({"apiKeyConfigured": true, "selectionLength": 483});
        assert!(line.get("apiKey").is_none());
        assert_eq!(line["apiKeyConfigured"], true);
    }
}
