"""Smoke spec: the deployable app, as Wasmer runs it, against a real Postgres and a temp volume."""

import json
import re
from concurrent.futures import ThreadPoolExecutor

from .conftest import get, migrate, run_sql


def test_app_serves_frontend_and_reports_a_migrated_database(fresh_db, spawn_app, tmp_path):
    # Migrations from empty, run as a pipeline step (never on boot), twice and concurrently: idempotent.
    with ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(lambda _: migrate(fresh_db), range(3)))
    assert all(r.returncode == 0 for r in results), [r.stderr for r in results]
    assert run_sql(fresh_db, "SELECT version, name FROM schema_migrations ORDER BY version") == [[1, "schema_migrations"]]

    app = spawn_app(tmp_path / "volume", db=fresh_db)

    status, _, body = get(app.url + "/healthz?deep=1")
    health = json.loads(body)
    assert status == 200
    assert health["ok"] is True and health["sha"] == "e2e"
    assert health["db"] == {"ok": True, "configured": True, "schema": 1}
    assets = health["assets"]
    assert re.fullmatch(r"[0-9a-f]{12}", assets)

    status, headers, index = get(app.url + "/")
    assert status == 200 and headers["cache-control"] == "no-cache"
    assert f'<base href="/v/{assets}/">'.encode() in index
    assert "default-src 'self'" in headers["content-security-policy"]

    status, headers, js = get(f"{app.url}/v/{assets}/js/main.js", {"Accept-Encoding": "gzip"})
    assert status == 200
    assert headers["content-type"] == "text/javascript; charset=utf-8"
    assert headers["cache-control"] == "public, max-age=31536000, immutable"
    assert headers["content-encoding"] == "gzip"

    status, headers, _ = get(f"{app.url}/v/{assets}/manifest.webmanifest")
    assert status == 200 and headers["content-type"] == "application/manifest+json"

    status, headers, sw = get(app.url + "/sw.js")
    assert status == 200 and headers["cache-control"] == "no-cache"
    assert f'const VERSION = "{assets}"'.encode() in sw

    # The volume now holds this asset set for old service workers.
    assert (tmp_path / "volume" / "assets" / assets / ".complete").exists()


def test_database_outage_fails_only_the_deep_health_check(fresh_db, spawn_app, tmp_path):
    assert migrate(fresh_db).returncode == 0
    broken = {**fresh_db, "DB_PASSWORD": "wrong"}
    app = spawn_app(tmp_path / "volume", db=broken)
    status, _, body = get(app.url + "/healthz?deep=1")
    assert status == 503
    assert json.loads(body)["db"]["ok"] is False
    assert get(app.url + "/healthz")[0] == 200
    assert get(app.url + "/")[0] == 200


def test_unmigrated_database_is_reported_as_connected_but_not_migrated(fresh_db, spawn_app, tmp_path):
    app = spawn_app(tmp_path / "volume", db=fresh_db)
    status, _, body = get(app.url + "/healthz?deep=1")
    assert status == 503
    assert json.loads(body)["db"] == {"ok": False, "configured": True, "connected": True, "error": "not migrated"}
