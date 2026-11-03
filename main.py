"""Klara's Farm: tiny ASGI app that serves the web/ folder from memory.

Run locally:  uvicorn main:app --port 8000
"""

import gzip
import hashlib
import mimetypes
import os
from pathlib import Path

WEB_DIR = Path(__file__).parent / "web"

MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".json": "application/json",
}


def load_assets(root: Path) -> dict[str, dict]:
    """Read every file under root once: bytes, gzip bytes, MIME type and ETag."""
    assets = {}
    for path in sorted(p for p in root.rglob("*") if p.is_file()):
        body = path.read_bytes()
        url = "/" + path.relative_to(root).as_posix()
        mime = MIME.get(path.suffix) or mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        assets[url] = {
            "body": body,
            "gzip": gzip.compress(body, mtime=0),
            "type": mime,
            "etag": '"' + hashlib.sha256(body).hexdigest()[:16] + '"',
        }
    return assets


def make_app(root: Path = WEB_DIR):
    assets = load_assets(root)

    async def app(scope, receive, send):
        if scope["type"] == "lifespan":
            while True:
                message = await receive()
                if message["type"] == "lifespan.startup":
                    await send({"type": "lifespan.startup.complete"})
                elif message["type"] == "lifespan.shutdown":
                    await send({"type": "lifespan.shutdown.complete"})
                    return
        if scope["type"] != "http":
            return

        path = scope["path"]
        if path == "/healthz":
            sha = os.environ.get("GIT_SHA", "dev")
            return await respond(send, 200, b'{"ok":true,"sha":"' + sha.encode() + b'"}', "application/json")
        if path == "/":
            path = "/index.html"
        asset = assets.get(path)
        if asset is None or scope["method"] not in ("GET", "HEAD"):
            return await respond(send, 404, b"not found", "text/plain")

        headers = dict(scope.get("headers", []))
        if headers.get(b"if-none-match", b"").decode() == asset["etag"]:
            return await respond(send, 304, b"", asset["type"], etag=asset["etag"])
        use_gzip = b"gzip" in headers.get(b"accept-encoding", b"")
        body = asset["gzip"] if use_gzip else asset["body"]
        if scope["method"] == "HEAD":
            body = b""
        await respond(send, 200, body, asset["type"], etag=asset["etag"], gzipped=use_gzip,
                      length=len(asset["gzip"] if use_gzip else asset["body"]))

    return app


async def respond(send, status, body, content_type, etag=None, gzipped=False, length=None):
    headers = [
        (b"content-type", content_type.encode()),
        (b"content-length", str(len(body) if length is None else length).encode()),
        (b"cache-control", b"no-cache"),
        (b"x-content-type-options", b"nosniff"),
    ]
    if etag:
        headers.append((b"etag", etag.encode()))
    if gzipped:
        headers += [(b"content-encoding", b"gzip"), (b"vary", b"accept-encoding")]
    await send({"type": "http.response.start", "status": status, "headers": headers})
    await send({"type": "http.response.body", "body": body})


app = make_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))
