"""Apply SQL migrations in order. Idempotent and safe to run from several processes.

Run as a pipeline step, never on instance boot:  python -m backend.migrate
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

from backend import db

MIGRATIONS = Path(__file__).parent / "migrations"
LOCK_ID = 7_412_202_611  # arbitrary, constant advisory lock key for this app
_NAME = re.compile(r"^(\d{4})_([a-z0-9_]+)\.sql$")


def discover(directory: Path = MIGRATIONS) -> list[tuple[int, str, str]]:
    found = []
    for path in sorted(directory.glob("*.sql")):
        match = _NAME.match(path.name)
        if not match:
            raise ValueError(f"bad migration file name: {path.name}")
        found.append((int(match.group(1)), match.group(2), path.read_text()))
    versions = [v for v, _, _ in found]
    if versions != list(range(1, len(versions) + 1)):
        raise ValueError(f"migrations must be numbered 1..n without gaps, got {versions}")
    return found


def apply(conn, migrations) -> list[int]:
    """Apply pending migrations under an advisory lock; returns the versions applied now."""
    applied_now = []
    conn.run("SELECT pg_advisory_lock(:k)", k=LOCK_ID)
    try:
        conn.run(migrations[0][2])  # 0001 creates schema_migrations itself, idempotently
        done = {row[0] for row in conn.run("SELECT version FROM schema_migrations")}
        for version, name, sql in migrations:
            if version in done:
                continue
            conn.run("BEGIN")
            try:
                conn.run(sql)
                conn.run("INSERT INTO schema_migrations (version, name) VALUES (:v, :n)", v=version, n=name)
                conn.run("COMMIT")
            except Exception:
                conn.run("ROLLBACK")
                raise
            applied_now.append(version)
    finally:
        conn.run("SELECT pg_advisory_unlock(:k)", k=LOCK_ID)
    return applied_now


def main() -> int:
    cfg = db.config()
    if cfg is None:
        print("DB_HOST is not set; nothing to migrate")
        return 0
    conn = db.connect(cfg)
    try:
        applied = apply(conn, discover())
    finally:
        conn.close()
    print(f"applied: {applied or 'nothing (up to date)'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
