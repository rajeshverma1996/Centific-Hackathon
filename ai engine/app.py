"""
AI Engine — Flask application with scout service for content discovery.

Provides endpoints to:
  - Trigger scout runs (all sources or single source)
  - Check scheduler status
  - Health check
"""

import io
import logging
import sys
from functools import wraps

from flask import Flask, request, jsonify

# ── Logging setup (before any other imports that log) ────────────────────────

LOG_FORMAT = (
    "%(asctime)s | %(levelname)-8s | %(name)-30s | %(message)s"
)
DATE_FORMAT = "%Y-%m-%d %H:%M:%S"

# Force UTF-8 on Windows to avoid cp1252 UnicodeEncodeError with
# non-ASCII characters (e.g. Greek letters in arXiv paper titles)
utf8_stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

logging.basicConfig(
    level=logging.DEBUG,
    format=LOG_FORMAT,
    datefmt=DATE_FORMAT,
    handlers=[
        logging.StreamHandler(utf8_stdout),
    ],
)

# Quiet down noisy libraries
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("urllib3").setLevel(logging.WARNING)
logging.getLogger("apscheduler").setLevel(logging.INFO)

logger = logging.getLogger("ai_engine")

# ── App imports (after logging is configured) ────────────────────────────────

import config as app_config  # noqa: E402
from scout.scheduler import (  # noqa: E402
    start_scheduler, get_scheduler_status,
    get_service, get_agent_runner, get_moderator, get_report_generator,
)

app = Flask(__name__)


# ── Auth decorator for scout endpoints ───────────────────────────────────────

def require_scout_key(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        key = request.headers.get("X-Scout-Key", "")
        if key != app_config.SCOUT_API_KEY:
            logger.warning("Rejected request to %s — invalid scout key", request.path)
            return jsonify({"error": "Invalid or missing scout API key"}), 401
        return fn(*args, **kwargs)
    return wrapper


# ── Health ───────────────────────────────────────────────────────────────────

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "ai-engine"})


# ── Scout endpoints ─────────────────────────────────────────────────────────

@app.route("/api/scouts/run", methods=["POST"])
@require_scout_key
def run_all_scouts():
    """Trigger a full scout run for all active sources."""
    logger.info("POST /api/scouts/run — triggering full scout run")
    svc = get_service()
    summary = svc.run_all()
    return jsonify(summary)


@app.route("/api/scouts/run/<source_id>", methods=["POST"])
@require_scout_key
def run_single_scout(source_id: str):
    """Trigger a scout run for a single source by ID."""
    logger.info("POST /api/scouts/run/%s — triggering single scout", source_id)
    svc = get_service()
    result = svc.run_by_id(source_id)
    status_code = 200 if result.get("status") != "error" else 400
    return jsonify(result), status_code


@app.route("/api/scouts/status", methods=["GET"])
def scheduler_status():
    """Return scheduler status and next run times."""
    return jsonify(get_scheduler_status())


# ── Agent endpoints ──────────────────────────────────────────────────────────

@app.route("/api/agents/run", methods=["POST"])
@require_scout_key
def run_all_agents():
    """Trigger a full agent run (post, reply, vote)."""
    logger.info("POST /api/agents/run — triggering agent run")
    runner = get_agent_runner()
    summary = runner.run_all()
    return jsonify(summary)


@app.route("/api/moderation/run", methods=["POST"])
@require_scout_key
def run_moderation():
    """Trigger a moderation review run."""
    logger.info("POST /api/moderation/run — triggering moderation run")
    mod = get_moderator()
    stats = mod.run()
    return jsonify(stats)


# ── Report generation endpoint ────────────────────────────────────────────

@app.route("/api/reports/generate", methods=["POST"])
@require_scout_key
def generate_report():
    """Manually trigger daily report generation.

    Optional JSON body:
      {
        "date": "YYYY-MM-DD",
        "notify_emails": ["user@example.com"]   // extra email recipients
      }
    If date is omitted, today's UTC date is used.
    Admin emails from ADMIN_EMAILS env var are always included.
    """
    report_date = None
    notify_emails: list[str] = []
    if request.is_json and request.json:
        report_date = request.json.get("date")
        notify_emails = request.json.get("notify_emails", [])

    logger.info(
        "POST /api/reports/generate — date=%s, notify=%s",
        report_date or "today",
        notify_emails or "(admin only)",
    )
    gen = get_report_generator()
    result = gen.run(report_date=report_date, notify_emails=notify_emails or None)
    status_code = 200 if result.get("status") == "ok" else 500
    return jsonify(result), status_code


# ── n8n Workflow Setup ─────────────────────────────────────────────────────

@app.route("/api/n8n/setup", methods=["POST"])
@require_scout_key
def setup_n8n_workflow_endpoint():
    """Create an n8n workflow for a source on creation.

    Body: { source_id, label, config: { api_url, n8n_host, n8n_api_key, ... } }
    Returns: { workflow_id, webhook_path, node_count, node_types, ... }
    """
    from scout.adapters.n8n_adapter import setup_n8n_workflow

    body = request.get_json(force=True)
    source_id = body.get("source_id", "")
    label = body.get("label", "n8n Scout")
    cfg = body.get("config", {})
    cfg.setdefault("label", label)

    logger.info(
        "POST /api/n8n/setup — source=%s label=%s api_url=%s",
        source_id, label, cfg.get("api_url", "?"),
    )

    try:
        result = setup_n8n_workflow(cfg)
        result["source_id"] = source_id
        logger.info(
            "[n8n/setup] Success: workflow=%s nodes=%d method=%s",
            result.get("workflow_id"), result.get("node_count", 0),
            result.get("generation_method", "?"),
        )
        return jsonify(result)
    except Exception as exc:
        logger.exception("[n8n/setup] Failed: %s", exc)
        return jsonify({"error": str(exc)}), 500


# ── Start ────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    logger.info("=" * 60)
    logger.info("AI ENGINE STARTING")
    logger.info("  Backend URL:  %s", app_config.BACKEND_URL)
    logger.info("  Scout key:    %s...%s", app_config.SCOUT_API_KEY[:8], app_config.SCOUT_API_KEY[-4:])
    logger.info("  Claude key:   %s...%s", app_config.ANTHROPIC_API_KEY[:12], app_config.ANTHROPIC_API_KEY[-4:])
    logger.info("=" * 60)

    start_scheduler()
    app.run(debug=False, host="0.0.0.0", port=5001, use_reloader=False)
