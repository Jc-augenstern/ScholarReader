CREATE TABLE favorites (
  id                    TEXT PRIMARY KEY,
  document_id           TEXT NOT NULL
                          REFERENCES documents(id) ON DELETE CASCADE,
  selected_text         TEXT NOT NULL CHECK (length(trim(selected_text)) > 0),
  normalized_text       TEXT NOT NULL CHECK (length(normalized_text) > 0),
  page_number           INTEGER NOT NULL CHECK (page_number > 0),
  text_start_index      INTEGER CHECK (text_start_index IS NULL OR text_start_index >= 0),
  text_end_index        INTEGER CHECK (text_end_index IS NULL OR text_end_index >= 0),
  context_before        TEXT NOT NULL DEFAULT '',
  context_after         TEXT NOT NULL DEFAULT '',
  selection_rects_json  TEXT NOT NULL DEFAULT '[]'
                          CHECK (json_valid(selection_rects_json)),
  document_hash         TEXT NOT NULL CHECK (length(document_hash) = 64),
  locator_version       INTEGER NOT NULL DEFAULT 1 CHECK (locator_version > 0),
  note                  TEXT NOT NULL DEFAULT '',
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL,
  CHECK (
    text_end_index IS NULL OR text_start_index IS NULL OR
    text_end_index >= text_start_index
  )
) STRICT;

CREATE INDEX idx_favorites_document_page
  ON favorites(document_id, page_number, created_at DESC);

CREATE INDEX idx_favorites_recent
  ON favorites(created_at DESC);

CREATE TABLE tags (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  normalized_name  TEXT NOT NULL UNIQUE,
  created_at       INTEGER NOT NULL
) STRICT;

CREATE TABLE favorite_tags (
  favorite_id  TEXT NOT NULL REFERENCES favorites(id) ON DELETE CASCADE,
  tag_id       TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (favorite_id, tag_id)
) WITHOUT ROWID, STRICT;

CREATE INDEX idx_favorite_tags_tag
  ON favorite_tags(tag_id, favorite_id);

PRAGMA user_version = 2;
