"""Entry point for Wasmer Edge (`python main.py`) and local runs (`uvicorn main:app`)."""

import os
from pathlib import Path

from backend.app import make_app

app = make_app(Path(__file__).parent / "web")

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))
