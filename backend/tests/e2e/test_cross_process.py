"""Cross-process spec: two app processes and a restart, sharing one database and one volume."""

import json
import shutil

from .conftest import ROOT, get, migrate, run_sql


def health(app):
    status, _, body = get(app.url + "/healthz?deep=1")
    assert status == 200, body
    return json.loads(body)


def test_two_versions_share_the_volume_and_database_across_restarts(fresh_db, spawn_app, tmp_path):
    assert migrate(fresh_db).returncode == 0
    volume = tmp_path / "volume"

    # Version A is the real frontend; version B is the same frontend with one changed file.
    a_web = tmp_path / "a" / "web"
    b_web = tmp_path / "b" / "web"
    shutil.copytree(ROOT / "web", a_web)
    shutil.copytree(ROOT / "web", b_web)
    (b_web / "css" / "tokens.css").write_text((b_web / "css" / "tokens.css").read_text() + "\n/* v2 */\n")

    a = spawn_app(volume, web_dir=a_web, db=fresh_db, sha="aaa")
    b = spawn_app(volume, web_dir=b_web, db=fresh_db, sha="bbb")
    ha, hb = health(a), health(b)
    assert ha["assets"] != hb["assets"]
    assert ha["db"]["schema"] == hb["db"]["schema"] == 1

    # A service worker that started installing version A can finish from instance B, and vice versa.
    a_css = f"/v/{ha['assets']}/css/tokens.css"
    b_css = f"/v/{hb['assets']}/css/tokens.css"
    status, headers, body = get(b.url + a_css)
    assert status == 200
    assert b"/* v2 */" not in body
    assert headers["cache-control"] == "public, max-age=31536000, immutable"
    status, _, body = get(a.url + b_css)
    assert status == 200
    assert b"/* v2 */" in body

    # Each instance's own sw.js points at its own version.
    assert f'"{ha["assets"]}"'.encode() in get(a.url + "/sw.js")[2]
    assert f'"{hb["assets"]}"'.encode() in get(b.url + "/sw.js")[2]

    # Restart A: state on the volume and in the database survives the process.
    a.stop()
    a2 = spawn_app(volume, web_dir=a_web, db=fresh_db, sha="aaa")
    assert health(a2)["assets"] == ha["assets"]
    assert get(a2.url + b_css)[0] == 200
    assert run_sql(fresh_db, "SELECT count(*) FROM schema_migrations") == [[1]]

    # Unknown versions are never guessed.
    assert get(a2.url + "/v/000000000000/css/tokens.css")[0] == 404
