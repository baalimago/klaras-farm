"""Klara's Farm backend: a small ASGI app with no framework.

It serves the frontend from memory under content-hashed paths, renders the
service worker, and answers health checks. Everything that depends on the
environment is read lazily per request, so Wasmer's instaboot snapshots never
freeze configuration or open sockets.

Routes:
    /                 index.html with <base href="/v/<hash>/">, never cached
    /v/<hash>/<path>  frontend assets, cached forever (immutable)
    /sw.js            service worker rendered with the asset hash, never cached
    /healthz          {"ok", "sha", "assets"}; ?deep=1 also checks Postgres
    POST /api/client-log  a short client error report, printed to the server log
                          (so device-only failures, e.g. on an iPad, show up in Wasmer logs)
"""

from __future__ import annotations

import gzip
import hashlib
import json
import mimetypes
import os
from pathlib import Path

from backend import archive

INDEX = "index.html"
SW_TEMPLATE = "sw.template.js"
NOT_SERVED = {SW_TEMPLATE}
COMPRESSIBLE = ("text/", "application/javascript", "application/json", "application/manifest+json", "image/svg+xml")
MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".webmanifest": "application/manifest+json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".wav": "audio/wav",
    ".zip": "application/zip",
}
CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
    "img-src 'self' blob: data:; media-src 'self' blob: data:; connect-src 'self'; "
    "worker-src 'self'; manifest-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'"
)
IMMUTABLE = "public, max-age=31536000, immutable"
NO_CACHE = "no-cache"


class Asset:
    __slots__ = ("body", "gz", "type", "etag")

    def __init__(self, body: bytes, content_type: str):
        self.body = body
        self.type = content_type
        self.etag = '"' + hashlib.sha256(body).hexdigest()[:20] + '"'
        compressible = content_type.startswith(COMPRESSIBLE) and len(body) > 512
        self.gz = gzip.compress(body, compresslevel=9, mtime=0) if compressible else None


def mime_for(name: str) -> str:
    suffix = Path(name).suffix
    return MIME.get(suffix) or mimetypes.guess_type(name)[0] or "application/octet-stream"


def read_tree(root: Path) -> dict[str, bytes]:
    """Every file under root as {relative posix path: bytes}, skipping dotfiles and tests."""
    files = {}
    for path in sorted(root.rglob("*")):
        rel = path.relative_to(root).as_posix()
        if not path.is_file() or any(part.startswith(".") for part in rel.split("/")):
            continue
        if rel.endswith(".test.js"):
            continue
        files[rel] = path.read_bytes()
    return files


def tree_hash(files: dict[str, bytes]) -> str:
    h = hashlib.sha256()
    for rel in sorted(files):
        h.update(rel.encode() + b"\0" + hashlib.sha256(files[rel]).digest())
    return h.hexdigest()[:12]


class Site:
    """The frontend, loaded once: hashed assets, index.html and sw.js."""

    def __init__(self, root: Path):
        files = read_tree(root)
        if INDEX not in files or SW_TEMPLATE not in files:
            raise RuntimeError(f"{root} must contain {INDEX} and {SW_TEMPLATE}")
        self.hash = tree_hash(files)
        self.files = files
        prefix = f"/v/{self.hash}/"
        self.assets = {rel: Asset(body, mime_for(rel)) for rel, body in files.items() if rel not in NOT_SERVED}
        index = files[INDEX].replace(b"%ASSET_BASE%", prefix.encode())
        self.index = Asset(index, MIME[".html"])
        precache = ["/"] + [prefix + rel for rel in sorted(self.assets) if rel != INDEX]
        sw = (
            files[SW_TEMPLATE]
            .replace(b"__VERSION__", self.hash.encode())
            .replace(b"__PRECACHE__", json.dumps(precache).encode())
        )
        self.sw = Asset(sw, MIME[".js"])


def make_app(root: Path, data_dir_env: str = "KF_DATA_DIR"):
    site = Site(root)
    old_sets: dict[str, dict[str, Asset] | None] = {}
    archived = {"done": False}

    def data_dir() -> Path | None:
        value = os.environ.get(data_dir_env)
        return Path(value) if value else None

    def ensure_archived():
        # Done on the first request rather than at import, so instaboot snapshots stay clean.
        if archived["done"]:
            return
        archived["done"] = True
        directory = data_dir()
        if directory is not None:
            try:
                archive.store(directory, site.hash, {k: v for k, v in site.files.items() if k in site.assets})
            except OSError:
                pass  # the volume is a convenience for old clients; never fail a request over it

    def old_asset(version: str, rel: str) -> Asset | None:
        if version not in old_sets:
            directory = data_dir()
            files = archive.load(directory, version) if directory is not None else None
            old_sets[version] = {k: Asset(v, mime_for(k)) for k, v in files.items()} if files else None
        assets = old_sets[version]
        return assets.get(rel) if assets else None

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
        ensure_archived()
        method = scope["method"]
        path = scope["path"]
        headers = dict(scope.get("headers") or [])
        if path == "/api/client-log" and method == "POST":
            body = await read_body(receive, CLIENT_LOG_MAX)
            ua = headers.get(b"user-agent", b"").decode("latin-1")[:200]
            text = body.decode("utf-8", "replace").replace("\n", " | ")[:CLIENT_LOG_MAX]
            print(f"client-log ua={ua!r} {text}", flush=True)
            return await respond(send, 204, b"", "text/plain")
        if method not in ("GET", "HEAD"):
            return await respond(send, 405, b"method not allowed", "text/plain", extra=[(b"allow", b"GET, HEAD")])

        if path == "/healthz":
            body = health(site.hash, deep=b"deep=1" in scope.get("query_string", b""))
            status = 200 if body["ok"] else 503
            return await respond(send, status, json.dumps(body).encode(), "application/json", cache=NO_CACHE)
        if path in ("/", "/index.html"):
            return await serve(send, method, headers, site.index, NO_CACHE, extra=[(b"content-security-policy", CSP.encode())])
        if path == "/sw.js":
            return await serve(send, method, headers, site.sw, NO_CACHE)
        if path.startswith("/v/"):
            version, _, rel = path[3:].partition("/")
            if ".." in rel.split("/") or not rel:
                return await not_found(send)
            if version == site.hash:
                asset = site.assets.get(rel)
            else:
                asset = old_asset(version, rel) if archive.valid_version(version) else None
            if asset is not None:
                return await serve(send, method, headers, asset, IMMUTABLE)
        return await not_found(send)

    app.site = site  # for tests
    return app


CLIENT_LOG_MAX = 2000


async def read_body(receive, limit: int) -> bytes:
    """Reads a request body, keeping at most `limit` bytes."""
    chunks, size = [], 0
    while True:
        message = await receive()
        if message["type"] != "http.request":
            break
        part = message.get("body", b"")
        if size < limit:
            chunks.append(part[: limit - size])
        size += len(part)
        if not message.get("more_body"):
            break
    return b"".join(chunks)


def health(asset_hash: str, deep: bool) -> dict:
    body = {"ok": True, "sha": os.environ.get("GIT_SHA", "dev"), "assets": asset_hash}
    if deep:
        from backend import db  # imported lazily: the static app never needs a driver

        body["db"] = db.check()
        body["ok"] = body["db"]["ok"]
    return body


async def serve(send, method, headers, asset: Asset, cache: str, extra=()):
    if headers.get(b"if-none-match", b"").decode() == asset.etag:
        return await respond(send, 304, b"", asset.type, etag=asset.etag, cache=cache, extra=extra)
    use_gzip = asset.gz is not None and b"gzip" in headers.get(b"accept-encoding", b"")
    body = asset.gz if use_gzip else asset.body
    extra = list(extra)
    if asset.gz is not None:
        extra.append((b"vary", b"accept-encoding"))
    if use_gzip:
        extra.append((b"content-encoding", b"gzip"))
    await respond(send, 200, b"" if method == "HEAD" else body, asset.type, etag=asset.etag, cache=cache,
                  extra=extra, length=len(body))


async def not_found(send):
    await respond(send, 404, b"not found", "text/plain; charset=utf-8", cache=NO_CACHE)


async def respond(send, status, body, content_type, etag=None, cache=NO_CACHE, extra=(), length=None):
    headers = [
        (b"content-type", content_type.encode()),
        (b"content-length", str(len(body) if length is None else length).encode()),
        (b"cache-control", cache.encode()),
        (b"x-content-type-options", b"nosniff"),
        (b"referrer-policy", b"no-referrer"),
    ]
    if etag:
        headers.append((b"etag", etag.encode()))
    headers.extend(extra)
    await send({"type": "http.response.start", "status": status, "headers": headers})
    await send({"type": "http.response.body", "body": body})
