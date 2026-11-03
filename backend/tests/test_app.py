import asyncio
import gzip
import json
from pathlib import Path

import pytest

from backend import archive
from backend.app import make_app, tree_hash

ROOT = Path(__file__).resolve().parents[2]


def call(app, path, method="GET", headers=(), query=b"", body=b""):
    sent = []

    async def receive():
        return {"type": "http.request", "body": body, "more_body": False}

    async def send(message):
        sent.append(message)

    scope = {
        "type": "http",
        "method": method,
        "path": path,
        "query_string": query,
        "headers": [(k.encode(), v.encode()) for k, v in headers],
    }
    asyncio.run(app(scope, receive, send))
    start = sent[0]
    body = b"".join(m.get("body", b"") for m in sent[1:])
    return start["status"], {k.decode(): v.decode() for k, v in start["headers"]}, body


@pytest.fixture
def site(tmp_path):
    web = tmp_path / "web"
    (web / "js").mkdir(parents=True)
    (web / "index.html").write_text('<!doctype html><base href="%ASSET_BASE%"><title>t</title>')
    (web / "sw.template.js").write_text('const VERSION = "__VERSION__"; const PRECACHE = __PRECACHE__;')
    (web / "js" / "main.js").write_text("export const x = 1;\n" * 100)
    (web / "js" / "main.test.js").write_text("test")
    (web / ".hidden").write_text("secret")
    return web


def test_index_has_base_href_for_this_asset_version_and_is_never_cached(site, monkeypatch):
    monkeypatch.delenv("KF_DATA_DIR", raising=False)
    app = make_app(site)
    status, headers, body = call(app, "/")
    assert status == 200
    assert f'<base href="/v/{app.site.hash}/">'.encode() in body
    assert headers["cache-control"] == "no-cache"
    assert "script-src 'self'" in headers["content-security-policy"]


def test_hashed_assets_are_immutable_with_correct_mime_and_gzip(site):
    app = make_app(site)
    status, headers, body = call(app, f"/v/{app.site.hash}/js/main.js", headers=[("accept-encoding", "gzip")])
    assert status == 200
    assert headers["content-type"] == "text/javascript; charset=utf-8"
    assert headers["cache-control"] == "public, max-age=31536000, immutable"
    assert gzip.decompress(body).startswith(b"export const x")
    assert headers["content-length"] == str(len(body))


def test_etag_revalidation_and_head(site):
    app = make_app(site)
    url = f"/v/{app.site.hash}/js/main.js"
    _, headers, _ = call(app, url)
    assert call(app, url, headers=[("if-none-match", headers["etag"])])[0] == 304
    status, h, body = call(app, url, method="HEAD")
    assert status == 200
    assert body == b""
    assert int(h["content-length"]) > 0


def test_service_worker_is_rendered_with_version_and_precache(site):
    app = make_app(site)
    status, headers, body = call(app, "/sw.js")
    assert status == 200
    assert headers["cache-control"] == "no-cache"
    text = body.decode()
    assert f'"{app.site.hash}"' in text
    precache = json.loads(text.split("PRECACHE = ")[1].rstrip(";"))
    assert "/" in precache
    assert f"/v/{app.site.hash}/js/main.js" in precache
    assert not any("sw.template" in p or "index.html" in p for p in precache)


def test_tests_hidden_files_templates_and_traversal_are_not_served(site):
    app = make_app(site)
    h = app.site.hash
    for path in [
        f"/v/{h}/js/main.test.js",
        f"/v/{h}/.hidden",
        f"/v/{h}/sw.template.js",
        f"/v/{h}/../main.py",
        "/v/000000000000/js/main.js",
        "/main.py",
        "/nope",
    ]:
        assert call(app, path)[0] == 404, path
    assert call(app, "/", method="POST")[0] == 405


def test_hash_changes_with_content(site):
    before = make_app(site).site.hash
    (site / "js" / "main.js").write_text("changed")
    assert make_app(site).site.hash != before
    assert tree_hash({"a": b"1"}) != tree_hash({"b": b"1"})


def test_healthz_reports_sha_and_assets_and_skips_db_unless_deep(site, monkeypatch):
    monkeypatch.setenv("GIT_SHA", "abc123")
    monkeypatch.delenv("DB_HOST", raising=False)
    app = make_app(site)
    status, _, body = call(app, "/healthz")
    assert status == 200
    assert json.loads(body) == {"ok": True, "sha": "abc123", "assets": app.site.hash}
    status, _, body = call(app, "/healthz", query=b"deep=1")
    assert json.loads(body)["db"] == {"ok": True, "configured": False}


def test_old_asset_sets_are_archived_on_the_volume_and_served_by_newer_instances(site, tmp_path, monkeypatch):
    volume = tmp_path / "volume"
    monkeypatch.setenv("KF_DATA_DIR", str(volume))
    old = make_app(site)
    call(old, "/healthz")  # first request archives this version
    old_hash = old.site.hash
    (site / "js" / "main.js").write_text("export const v = 2;")
    new = make_app(site)
    assert new.site.hash != old_hash
    status, _, body = call(new, f"/v/{old_hash}/js/main.js")
    assert status == 200
    assert body.startswith(b"export const x")
    assert set(archive.versions(volume)) == {old_hash, new.site.hash}


def test_archive_keeps_only_the_newest_sets(tmp_path):
    for i in range(7):
        archive.store(tmp_path, f"{i:012x}", {"a.js": b"x"})
    assert len(archive.versions(tmp_path)) == archive.KEEP
    assert archive.load(tmp_path, "../../etc") is None


def test_real_web_folder_boots():
    app = make_app(ROOT / "web")
    status, _, body = call(app, "/")
    assert status == 200
    assert b"kf-board" in body


def test_client_log_prints_a_capped_line(site, capsys):
    app = make_app(site)
    status, _, _ = call(
        app, "/api/client-log", method="POST", headers=[("user-agent", "iPad")], body=b"boom\nat x" + b"y" * 5000
    )
    assert status == 204
    out = capsys.readouterr().out
    assert "client-log ua='iPad' boom | at x" in out
    assert len(out) < 2300
    assert call(app, "/api/client-log")[0] == 404  # GET is not a route
