CREATE TABLE documents (
  id                  TEXT PRIMARY KEY,
  title               TEXT NOT NULL,
  filename            TEXT NOT NULL,
  filepath            TEXT NOT NULL,
  path_key             TEXT NOT NULL UNIQUE,
  file_hash            TEXT NOT NULL CHECK (length(file_hash) = 64),
  file_size            INTEGER NOT NULL CHECK (file_size >= 0),
  source_modified_at   INTEGER,
  page_count           INTEGER CHECK (page_count IS NULL OR page_count > 0),
  is_starred           INTEGER NOT NULL DEFAULT 0 CHECK (is_starred IN (0, 1)),
  created_at           INTEGER NOT NULL,
  last_opened_at       INTEGER,
  updated_at           INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_documents_hash
  ON documents(file_hash, file_size);

CREATE INDEX idx_documents_recent
  ON documents(last_opened_at DESC);

CREATE TABLE reading_progress (
  document_id          TEXT PRIMARY KEY
                        REFERENCES documents(id) ON DELETE CASCADE,
  page_number          INTEGER NOT NULL CHECK (page_number > 0),
  page_offset_ratio    REAL NOT NULL DEFAULT 0
                        CHECK (page_offset_ratio >= 0 AND page_offset_ratio <= 1),
  zoom_mode            TEXT NOT NULL DEFAULT 'fit-width'
                        CHECK (zoom_mode IN ('custom', 'fit-page', 'fit-width')),
  zoom_value           REAL NOT NULL DEFAULT 1 CHECK (zoom_value > 0),
  rotation             INTEGER NOT NULL DEFAULT 0
                        CHECK (rotation IN (0, 90, 180, 270)),
  updated_at           INTEGER NOT NULL
) STRICT;

CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value_json  TEXT NOT NULL CHECK (json_valid(value_json)),
  updated_at  INTEGER NOT NULL
) STRICT;

PRAGMA user_version = 1;
