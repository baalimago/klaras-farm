# Backend domain

Keep this file current: update it in the same commit as any change to this domain.

## Purpose

The backend is a small framework-free Python ASGI app that serves the frontend from memory under content-hashed, immutable paths, renders the service worker, answers health checks, prints client error reports to the server log, and keeps old asset sets on the volume so service workers mid-install never break. It also owns Postgres access and SQL migrations, which exist for the later encrypted backup. Playing never needs the server beyond the first load: all family data stays on the iPad.

## Files

- `main.py`: entry point. Builds `app = make_app(<repo>/web)`. `python main.py` runs uvicorn on `PORT` (default 8000); `uvicorn main:app` also works.
- `pyproject.toml`: package `klaras-farm`, Python 3.12 or newer, deps `uvicorn`, `pg8000`; dev extras `pytest`, `testcontainers[postgres]`; pytest runs `backend/tests`. `requirements.txt` mirrors the runtime deps.
- `backend/app.py`: `make_app`, `Site` (hashed asset set, rendered `index.html` and `sw.js`), routing, caching headers, gzip, ETags, CSP, `/healthz`, `/api/client-log`.
- `backend/archive.py`: stores and loads asset sets under `<KF_DATA_DIR>/assets/<hash>/`, keeps the newest 5.
- `backend/db.py`: Postgres config from the environment, `connect`, and the deep health `check`.
- `backend/migrate.py`: discovers and applies `backend/migrations/NNNN_name.sql` under an advisory lock. Run with `python -m backend.migrate`.
- `backend/migrations/0001_schema_migrations.sql`: the `schema_migrations` bookkeeping table.

## Routes and contracts

| Route | Response | Cache |
| --- | --- | --- |
| `GET /`, `/index.html` | `index.html` with `%ASSET_BASE%` replaced by `/v/<hash>/`, plus the CSP header | `no-cache` |
| `GET /v/<hash>/<path>` | an asset of the current set, or of an archived set from the volume | `public, max-age=31536000, immutable` |
| `GET /sw.js` | `web/sw.template.js` with `__VERSION__` = hash and `__PRECACHE__` = JSON URL list | `no-cache` |
| `GET /healthz` | `{"ok", "sha", "assets"}`; with `?deep=1` also `"db"`, and 503 when the database check fails | `no-cache` |
| `POST /api/client-log` | 204; prints one `client-log ua=... <text>` line | none |
| other methods | 405 with `Allow: GET, HEAD` | |
| anything else | 404 | `no-cache` |

- Asset hash: first 12 hex chars of SHA-256 over sorted `path\0sha256(bytes)` pairs of every file under `web/`, skipping dotfiles and `*.test.js`. Any content change gives a new hash.
- `sw.template.js` is never served directly. The precache list is `/` plus every hashed asset except `index.html`.
- All responses carry `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`. Assets have strong ETags (first 20 hex of their SHA-256) and answer `If-None-Match` with 304. Text-like assets over 512 bytes are pre-gzipped once (level 9, `mtime=0`) and sent when `Accept-Encoding` has gzip, with `Vary: accept-encoding`. HEAD sends headers only.
- Paths with `..` segments or an empty asset path are 404. Archived versions must match `^[0-9a-f]{12}$`.
- CSP (on the index response only): `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob: data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'`.
- Client log: body capped at `CLIENT_LOG_MAX` (2000) bytes, newlines replaced by ` | `, user agent capped at 200 chars. The sender is `web/js/io/report.js` (`sendBeacon`, falling back to `fetch` with `keepalive`).

## Environment

- `PORT`: listen port for `python main.py`.
- `KF_DATA_DIR`: the persistent volume. Unset means no archive.
- `GIT_SHA`: reported by `/healthz` (default `dev`).
- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USERNAME`, `DB_PASSWORD`: injected by Wasmer. No `DB_HOST` means the database is not configured (`/healthz?deep=1` reports `configured: false` and stays ok; migrate is a no-op).
- `DB_SSLMODE`: default `require` (TLS without chain or hostname verification, as Wasmer's managed Postgres expects). Tests set `disable`.

## How it fits

- The backend serves `web/` as static files; it has no knowledge of the farm data model. The frontend runs with no build step, so whatever is in `web/` is what ships.
- `web/index.html` must contain `%ASSET_BASE%` (used as `<base href>`), and `web/sw.template.js` must contain `__VERSION__` and `__PRECACHE__`. `Site` refuses to start without both files.
- Frontend code fetches relative to the base (for example `data/starter.json` resolves to `/v/<hash>/data/starter.json`). Only `/sw.js`, `/healthz` and `/api/client-log` are absolute.
- The service worker precaches everything, serves cache-first, and never calls `skipWaiting` on its own; the app sends `skip-waiting` when a parent taps "Update ready".
- Deploys: pushes to `main` deploy to Wasmer Edge, which runs `python main.py`.

## Rules and gotchas

- Instaboot safety: nothing reads the environment, opens sockets or writes the volume at import time. `data_dir()` and the DB config are read per request; the archive write happens on the first request; `backend.db` is imported lazily, only for a deep health check.
- Hashed assets are immutable. Never change what a `/v/<hash>/` URL returns. Any edit under `web/` must produce a new hash, which happens automatically.
- Asset archive: on its first request each instance writes its set to `<KF_DATA_DIR>/assets/<hash>/` through a temp dir and an atomic rename, with a `.complete` marker; an existing set just has its marker touched. Sets are pruned to the newest 5 by marker mtime. Any instance can serve a set another instance wrote. Volume errors are swallowed: the archive is a convenience and must never fail a request.
- Each process caches archive lookups per version, including misses. A set written by another instance after this process missed it will not be seen until restart.
- Migrations run as a deploy step (`python -m backend.migrate`), never on instance boot. They take `pg_advisory_lock(7412202611)`, so several runners are safe. `0001` runs every time (it creates `schema_migrations` idempotently); each pending migration runs in its own transaction with its bookkeeping row.
- Migration files are named `NNNN_snake_name.sql`, numbered 1..n without gaps (`discover` raises otherwise). Schema changes are expand then contract, one release apart, because two versions run side by side during a deploy.
- `/healthz?deep=1` distinguishes "not migrated" (connected, `schema_migrations` missing) from connection errors. Only the deep check touches the database, so a database outage never takes the static app down.
- Keep the client log short and free of personal data; it lands in the Wasmer logs. Read those `client-log` lines before guessing at device-only bugs.
- No secrets in the repo. Database credentials and tokens live in the environment only.

## Tests

- `backend/tests/test_app.py`: base href and no-cache index, immutable hashed assets with MIME and gzip, ETag and HEAD, service worker rendering, hidden files, tests, templates and traversal not served, hash changes with content, `/healthz` with and without deep, archive serving old sets and pruning, the real `web/` folder boots, client log capping.
- `backend/tests/test_migrate.py`: migration numbering and the first migration's bookkeeping.
- `backend/tests/e2e/`: real processes, a real Postgres via testcontainers (needs Docker) and a temp volume. `test_smoke.py` (serves frontend, migrated database, database outage fails only the deep check, unmigrated database); `test_cross_process.py` (two versions share the volume and database across restarts).
- Run with `python -m pytest -q`. `npm run test:browser` also drives the real Python app with Chromium. CI (`.github/workflows/ci.yml`) runs all suites.
