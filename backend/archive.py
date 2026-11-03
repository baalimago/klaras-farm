"""Keeps the last few frontend asset sets on the volume.

A service worker that started installing version A must still be able to fetch
A's files after the server moved on to B, and different instances may run
different versions during a deploy. Each instance writes its own set to
<data_dir>/assets/<hash>/ and can serve any set another instance wrote.
"""

from __future__ import annotations

import os
import re
import shutil
from pathlib import Path

KEEP = 5
MARKER = ".complete"
_VERSION = re.compile(r"^[0-9a-f]{12}$")


def valid_version(version: str) -> bool:
    return bool(_VERSION.match(version))


def store(data_dir: Path, version: str, files: dict[str, bytes]) -> None:
    target = data_dir / "assets" / version
    if (target / MARKER).exists():
        os.utime(target / MARKER)
        return
    tmp = data_dir / "assets" / f".{version}.{os.getpid()}.tmp"
    shutil.rmtree(tmp, ignore_errors=True)
    for rel, body in files.items():
        path = tmp / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(body)
    (tmp / MARKER).write_text(version)
    try:
        tmp.rename(target)
    except OSError:
        shutil.rmtree(tmp, ignore_errors=True)  # another instance won the race; its copy is identical
    prune(data_dir)


def load(data_dir: Path, version: str) -> dict[str, bytes] | None:
    if not valid_version(version):
        return None
    root = data_dir / "assets" / version
    if not (root / MARKER).exists():
        return None
    files = {}
    for path in root.rglob("*"):
        rel = path.relative_to(root).as_posix()
        if path.is_file() and rel != MARKER:
            files[rel] = path.read_bytes()
    return files


def versions(data_dir: Path) -> list[str]:
    """Complete sets, newest first."""
    root = data_dir / "assets"
    if not root.exists():
        return []
    found = [p for p in root.iterdir() if valid_version(p.name) and (p / MARKER).exists()]
    found.sort(key=lambda p: (p / MARKER).stat().st_mtime, reverse=True)
    return [p.name for p in found]


def prune(data_dir: Path, keep: int = KEEP) -> None:
    for version in versions(data_dir)[keep:]:
        shutil.rmtree(data_dir / "assets" / version, ignore_errors=True)
