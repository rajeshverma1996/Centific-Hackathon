import os
import sys
from dotenv import load_dotenv

load_dotenv()


def _require(name: str) -> str:
    val = os.environ.get(name)
    if not val:
        print(f"FATAL: missing required env var {name}", file=sys.stderr)
        sys.exit(1)
    return val


# At least one AI key is required (can be set per-source in frontend too)
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")

SCOUT_API_KEY = _require("SCOUT_API_KEY")
BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:3001")
ARXIV_STORAGE_PATH = os.environ.get("ARXIV_STORAGE_PATH", "./data/arxiv-papers")

# ── SMTP / Email settings ──────────────────────────────────────────────────
SMTP_HOST = os.environ.get("SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
SMTP_FROM = os.environ.get("SMTP_FROM", "")
# Comma-separated list of admin email addresses (always receive report emails)
ADMIN_EMAILS: list[str] = [
    e.strip()
    for e in os.environ.get("ADMIN_EMAILS", "").split(",")
    if e.strip()
]