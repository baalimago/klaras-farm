# Klara's Farm

A playful, language-independent app that helps toddlers learn words together with a parent. iPad-first, runs in any browser. Python backend on Wasmer Edge, vanilla JS frontend.

- Design notes: [design/DESIGN.md](design/DESIGN.md) · Architecture: [design/ARCHITECTURE.md](design/ARCHITECTURE.md) · User stories: [design/USER_STORIES.md](design/USER_STORIES.md)
- Look-and-feel sketches (open in a browser): [final felt](design/sketches/final.html), [round 2](design/sketches/round2.html), [round 1](design/sketches/farm-sketches.html)

## Proof of concept

One felt pig on a farm. Tap it: it jumps, chimes and says "Pig" (browser speech for now; the parent's own recording comes in M1).

- `main.py`: a small ASGI app (`main:app`) that serves `web/` from memory with gzip, ETags and `/healthz`. Its only dependency is plain `uvicorn`.
- Run locally: `pip install uvicorn && uvicorn main:app --port 8000`, then open http://localhost:8000.
- Tests: `pip install pytest && python -m pytest`.
- Wasmer Edge: Python app with entrypoint `main:app` (dependencies from `pyproject.toml` / `requirements.txt`). `/healthz` reports `GIT_SHA` if set.
