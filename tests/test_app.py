import asyncio
import gzip

from main import make_app


def request(app, path, method="GET", headers=()):
    """Call the ASGI app in-process and collect the response."""
    sent = []

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        sent.append(message)

    scope = {"type": "http", "method": method, "path": path,
             "headers": [(k.encode(), v.encode()) for k, v in headers]}
    asyncio.run(app(scope, receive, send))
    start, body = sent[0], b"".join(m.get("body", b"") for m in sent[1:])
    return start["status"], {k.decode(): v.decode() for k, v in start["headers"]}, body


def make_site(tmp_path):
    (tmp_path / "index.html").write_text("<!doctype html><title>t</title>")
    (tmp_path / "app.js").write_text("console.log(1)")
    return make_app(tmp_path)


def test_root_serves_index_html(tmp_path):
    status, headers, body = request(make_site(tmp_path), "/")
    assert status == 200
    assert headers["content-type"] == "text/html; charset=utf-8"
    assert body.startswith(b"<!doctype html>")


def test_js_gets_module_mime_type_and_gzip_when_asked(tmp_path):
    status, headers, body = request(make_site(tmp_path), "/app.js", headers=[("accept-encoding", "gzip, br")])
    assert status == 200
    assert headers["content-type"].startswith("text/javascript")
    assert headers["content-encoding"] == "gzip"
    assert gzip.decompress(body) == b"console.log(1)"
    assert headers["content-length"] == str(len(body))


def test_matching_etag_returns_304(tmp_path):
    app = make_site(tmp_path)
    _, headers, _ = request(app, "/app.js")
    status, _, body = request(app, "/app.js", headers=[("if-none-match", headers["etag"])])
    assert status == 304 and body == b""


def test_unknown_path_and_bad_method_are_404(tmp_path):
    app = make_site(tmp_path)
    assert request(app, "/nope.js")[0] == 404
    assert request(app, "/../main.py")[0] == 404
    assert request(app, "/app.js", method="POST")[0] == 404


def test_healthz_reports_sha(tmp_path, monkeypatch):
    monkeypatch.setenv("GIT_SHA", "abc123")
    status, headers, body = request(make_site(tmp_path), "/healthz")
    assert status == 200 and headers["content-type"] == "application/json"
    assert body == b'{"ok":true,"sha":"abc123"}'


def test_real_web_folder_has_the_poc_page():
    status, _, body = request(make_app(), "/")
    assert status == 200 and b'data-name="Pig"' in body
