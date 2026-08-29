"""Read-only release smoke check for ScholarReader's local SQLite database."""

from __future__ import annotations

import json
import os
import sqlite3
from pathlib import Path


def main() -> None:
    database_path = (
        Path(os.environ["LOCALAPPDATA"])
        / "com.scholarreader.app"
        / "scholar-reader.db"
    )
    database = sqlite3.connect(f"file:{database_path}?mode=ro", uri=True)
    tables = [
        row[0]
        for row in database.execute(
            "SELECT name FROM sqlite_master "
            "WHERE type = 'table' AND name NOT LIKE '_sqlx%' ORDER BY name"
        )
    ]
    version = database.execute("PRAGMA user_version").fetchone()[0]
    print(
        json.dumps(
            {"database": str(database_path), "user_version": version, "tables": tables},
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
