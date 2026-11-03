"""Postgres access: configuration, connection and the health check.

Configuration comes only from the five variables Wasmer injects (DB_HOST,
DB_PORT, DB_NAME, DB_USERNAME, DB_PASSWORD), read when needed. TLS is required
without chain verification, as Wasmer's managed Postgres expects. Tests set
DB_SSLMODE=disable for a local container.
"""

from __future__ import annotations

import os
import ssl
from dataclasses import dataclass


@dataclass(frozen=True)
class DbConfig:
    host: str
    port: int
    name: str
    user: str
    password: str
    sslmode: str


def config() -> DbConfig | None:
    env = os.environ
    if not env.get("DB_HOST"):
        return None
    return DbConfig(
        host=env["DB_HOST"],
        port=int(env.get("DB_PORT", "5432")),
        name=env.get("DB_NAME", "postgres"),
        user=env.get("DB_USERNAME", "postgres"),
        password=env.get("DB_PASSWORD", ""),
        sslmode=env.get("DB_SSLMODE", "require"),
    )


def connect(cfg: DbConfig):
    import pg8000.native

    context = None
    if cfg.sslmode != "disable":
        context = ssl.create_default_context()
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
    return pg8000.native.Connection(
        user=cfg.user,
        password=cfg.password,
        host=cfg.host,
        port=cfg.port,
        database=cfg.name,
        ssl_context=context,
        timeout=5,
    )


def check() -> dict:
    cfg = config()
    if cfg is None:
        return {"ok": True, "configured": False}
    try:
        conn = connect(cfg)
    except Exception as exc:
        return {"ok": False, "configured": True, "error": type(exc).__name__}
    try:
        rows = conn.run("SELECT coalesce(max(version), 0) FROM schema_migrations")
        return {"ok": True, "configured": True, "schema": rows[0][0]}
    except Exception as exc:
        detail = exc.args[0] if exc.args and isinstance(exc.args[0], dict) else {}
        if detail.get("C") == "42P01":  # undefined_table: connected fine, migrations not run yet
            return {"ok": False, "configured": True, "connected": True, "error": "not migrated"}
        return {"ok": False, "configured": True, "connected": True, "error": type(exc).__name__}
    finally:
        conn.close()
