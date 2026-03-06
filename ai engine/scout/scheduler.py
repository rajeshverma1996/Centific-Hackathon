from __future__ import annotations

import logging
import os
import time
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.triggers.cron import CronTrigger

from scout.service import ScoutService

logger = logging.getLogger(__name__)

_scheduler: BackgroundScheduler | None = None
_scout_service: ScoutService | None = None
_agent_runner = None
_moderator = None
_report_generator = None


def get_service() -> ScoutService:
    global _scout_service
    if _scout_service is None:
        logger.info("[Scheduler] Creating ScoutService instance...")
        _scout_service = ScoutService()
    return _scout_service


def get_agent_runner():
    global _agent_runner
    if _agent_runner is None:
        from agents.runner import AgentRunner
        logger.info("[Scheduler] Creating AgentRunner instance...")
        _agent_runner = AgentRunner()
    return _agent_runner


def get_moderator():
    global _moderator
    if _moderator is None:
        from agents.moderator import ModeratorAgent
        logger.info("[Scheduler] Creating ModeratorAgent instance...")
        _moderator = ModeratorAgent()
    return _moderator


def get_report_generator():
    global _report_generator
    if _report_generator is None:
        from agents.report_generator import ReportGeneratorAgent
        logger.info("[Scheduler] Creating ReportGeneratorAgent instance...")
        _report_generator = ReportGeneratorAgent()
    return _report_generator


def _run_scouts_job() -> None:
    logger.info("[Scheduler] *** Scheduled scout run triggered ***")
    start = time.time()
    try:
        svc = get_service()
        summary = svc.run_all()
        total = summary.get("total_sources", 0)
        results = summary.get("results", [])
        ok = sum(1 for r in results if r.get("status") == "ok")
        elapsed = time.time() - start
        logger.info("[Scheduler] *** Scout run finished: %d/%d ok, %.1fs ***", ok, total, elapsed)
    except Exception as exc:
        logger.exception("[Scheduler] *** Scout run CRASHED: %s ***", exc)


def _run_agents_job() -> None:
    logger.info("[Scheduler] *** Scheduled agent run triggered ***")
    start = time.time()
    try:
        runner = get_agent_runner()
        summary = runner.run_all()
        acted = summary.get("acted", 0)
        total = summary.get("total", 0)
        elapsed = time.time() - start
        logger.info("[Scheduler] *** Agent run finished: %d/%d acted, %.1fs ***", acted, total, elapsed)
    except Exception as exc:
        logger.exception("[Scheduler] *** Agent run CRASHED: %s ***", exc)


def _run_moderation_job() -> None:
    logger.info("[Scheduler] *** Scheduled moderation run triggered ***")
    start = time.time()
    try:
        mod = get_moderator()
        stats = mod.run()
        elapsed = time.time() - start
        logger.info("[Scheduler] *** Moderation finished: %d reviewed, %.1fs ***", stats.get("reviewed", 0), elapsed)
    except Exception as exc:
        logger.exception("[Scheduler] *** Moderation CRASHED: %s ***", exc)


def _run_report_job() -> None:
    logger.info("[Scheduler] *** Scheduled report generation triggered ***")
    start = time.time()
    try:
        gen = get_report_generator()
        result = gen.run()  # defaults to today's UTC date
        elapsed = time.time() - start
        logger.info(
            "[Scheduler] *** Report generation finished: %s (status=%s, %.1fs) ***",
            result.get("date"), result.get("status"), elapsed,
        )
    except Exception as exc:
        logger.exception("[Scheduler] *** Report generation CRASHED: %s ***", exc)


def start_scheduler() -> BackgroundScheduler:
    global _scheduler

    if _scheduler and _scheduler.running:
        logger.info("[Scheduler] Already running, skipping start")
        return _scheduler

    scout_interval = int(os.environ.get("SCOUT_INTERVAL_MINUTES", "15"))

    # Agent and moderation support both _SECONDS and _MINUTES env vars
    agent_seconds = int(os.environ.get("AGENT_INTERVAL_SECONDS", "0"))
    agent_minutes = int(os.environ.get("AGENT_INTERVAL_MINUTES", "5"))
    mod_seconds = int(os.environ.get("MODERATION_INTERVAL_SECONDS", "0"))
    mod_minutes = int(os.environ.get("MODERATION_INTERVAL_MINUTES", "10"))

    _scheduler = BackgroundScheduler()

    _scheduler.add_job(
        _run_scouts_job,
        trigger=IntervalTrigger(minutes=scout_interval),
        id="scout_run",
        name=f"Scout run every {scout_interval} min",
        replace_existing=True,
    )

    if agent_seconds > 0:
        _scheduler.add_job(
            _run_agents_job,
            trigger=IntervalTrigger(seconds=agent_seconds),
            id="agent_run",
            name=f"Agent run every {agent_seconds}s",
            replace_existing=True,
        )
    else:
        _scheduler.add_job(
            _run_agents_job,
            trigger=IntervalTrigger(minutes=agent_minutes),
            id="agent_run",
            name=f"Agent run every {agent_minutes} min",
            replace_existing=True,
        )

    if mod_seconds > 0:
        _scheduler.add_job(
            _run_moderation_job,
            trigger=IntervalTrigger(seconds=mod_seconds),
            id="moderation_run",
            name=f"Moderation run every {mod_seconds}s",
            replace_existing=True,
        )
    else:
        _scheduler.add_job(
            _run_moderation_job,
            trigger=IntervalTrigger(minutes=mod_minutes),
            id="moderation_run",
            name=f"Moderation run every {mod_minutes} min",
            replace_existing=True,
        )

    # Daily report generation — default: once daily at 23:30 UTC
    report_cron_hour = int(os.environ.get("REPORT_CRON_HOUR", "23"))
    report_cron_minute = int(os.environ.get("REPORT_CRON_MINUTE", "30"))

    _scheduler.add_job(
        _run_report_job,
        trigger=CronTrigger(hour=report_cron_hour, minute=report_cron_minute),
        id="report_generation",
        name=f"Daily report at {report_cron_hour:02d}:{report_cron_minute:02d} UTC",
        replace_existing=True,
    )

    _scheduler.start()

    logger.info("[Scheduler] Started with %d jobs:", len(_scheduler.get_jobs()))
    for job in _scheduler.get_jobs():
        logger.info("  - %s (next: %s)", job.name, job.next_run_time)

    return _scheduler


def get_scheduler_status() -> dict:
    if not _scheduler or not _scheduler.running:
        return {"running": False, "jobs": []}

    jobs = []
    for job in _scheduler.get_jobs():
        jobs.append({
            "id": job.id,
            "name": job.name,
            "next_run": str(job.next_run_time) if job.next_run_time else None,
        })

    return {"running": True, "jobs": jobs}
