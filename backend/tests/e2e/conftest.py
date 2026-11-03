"""E2E harness: real processes, a real Postgres (testcontainers) and a temp dir as the volume.

Rules: ports come from the OS; readiness is polled with a deadline (no sleeps); Postgres is
started lazily, once per session, only for specs that ask for it; logs are kept on failure.
"""

from __future__ import annotations

import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def get(url: str, headers: dict | None = None, timeout: float = 5):
    """GET returning (status, headers, body) without raising on HTTP errors."""
    req = urllib.request.Request(url, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read()
    except urllib.error.HTTPError as e:
        return e.code, {k.lower(): v for k, v in e.headers.items()}, e.read()


@dataclass
class AppProcess:
    port: int
    proc: subprocess.Popen
    log: Path
    env: dict = field(default_factory=dict)

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def stop(self):
        if self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.proc.kill()


@pytest.fixture
def spawn_app(tmp_path, request):
    """spawn_app(volume, web_dir=None, db=None) → a running app process (main.py, as on Wasmer)."""
    started: list[AppProcess] = []

    def spawn(volume: Path, web_dir: Path | None = None, db: dict | None = None, sha: str = "e2e") -> AppProcess:
        app_dir = ROOT
        if web_dir is not None:
            # Same code, different frontend: copy main.py + backend next to the given web dir.
            app_dir = web_dir.parent
            if not (app_dir / "main.py").exists():
                shutil.copy(ROOT / "main.py", app_dir / "main.py")
                shutil.copytree(ROOT / "backend", app_dir / "backend", ignore=shutil.ignore_patterns("tests", "__pycache__"))
        port = free_port()
        log = tmp_path / f"app-{port}.log"
        env = {k: v for k, v in os.environ.items() if not k.startswith("DB_")}
        env.update({"PORT": str(port), "KF_DATA_DIR": str(volume), "GIT_SHA": sha, "PYTHONUNBUFFERED": "1"})
        env.update(db or {})
        proc = subprocess.Popen([sys.executable, "main.py"], cwd=app_dir, env=env, stdout=log.open("w"), stderr=subprocess.STDOUT)
        app = AppProcess(port, proc, log, env)
        started.append(app)
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            if proc.poll() is not None:
                raise RuntimeError(f"app exited early:\n{log.read_text()}")
            try:
                if get(app.url + "/healthz", timeout=1)[0] == 200:
                    return app
            except OSError:
                pass
            time.sleep(0.05)
        raise RuntimeError(f"app not ready:\n{log.read_text()}")

    yield spawn
    failed = getattr(request.node, "rep_call", None) is not None and request.node.rep_call.failed
    for app in started:
        app.stop()
        if failed:
            print(f"--- log {app.log.name} ---\n{app.log.read_text()}")


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    rep = outcome.get_result()
    setattr(item, f"rep_{rep.when}", rep)


@pytest.fixture(scope="session")
def postgres():
    """A real Postgres for the whole session, started on first use. Yields DB_* env vars."""
    try:
        try:
            from testcontainers.community.postgres import PostgresContainer
        except ImportError:
            from testcontainers.postgres import PostgresContainer
    except ImportError:
        pytest.skip("testcontainers is not installed (pip install 'testcontainers[postgres]')")
    try:
        container = PostgresContainer("postgres:16-alpine", username="kf", password="kf-secret", dbname="kf")
        container.start()
    except Exception as exc:  # noqa: BLE001 - no Docker → skip with the reason
        pytest.skip(f"Docker is not available: {exc}")
    try:
        yield {
            "DB_HOST": container.get_container_host_ip(),
            "DB_PORT": str(container.get_exposed_port(5432)),
            "DB_NAME": "kf",
            "DB_USERNAME": "kf",
            "DB_PASSWORD": "kf-secret",
            "DB_SSLMODE": "disable",
        }
    finally:
        container.stop()


@pytest.fixture
def fresh_db(postgres):
    """Drops everything so each spec starts from an empty database."""
    run_sql(postgres, "DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
    return postgres


def run_sql(db_env: dict, sql: str):
    import pg8000.native

    conn = pg8000.native.Connection(user=db_env["DB_USERNAME"], password=db_env["DB_PASSWORD"], host=db_env["DB_HOST"],
                                    port=int(db_env["DB_PORT"]), database=db_env["DB_NAME"])
    try:
        return conn.run(sql)
    finally:
        conn.close()


def migrate(db_env: dict) -> subprocess.CompletedProcess:
    env = {**os.environ, **db_env}
    return subprocess.run([sys.executable, "-m", "backend.migrate"], cwd=ROOT, env=env, capture_output=True, text=True, timeout=60)
