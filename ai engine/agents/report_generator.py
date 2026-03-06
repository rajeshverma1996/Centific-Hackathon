"""ReportGeneratorAgent: analyses daily platform activity and generates a summary report."""

from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone
from typing import Any

import httpx

import config as app_config
from agents.brain import AgentBrain
from agents.prompts import REPORT_SYSTEM, REPORT_USER_PROMPT
from utils.report_pdf import generate_report_pdf
from utils.email_sender import send_report_email, build_report_html

logger = logging.getLogger(__name__)


class ReportGeneratorAgent:
    """Fetches aggregated daily data, asks an LLM to summarize it, and
    upserts the result into the daily_reports table via the backend API."""

    def __init__(self) -> None:
        self.brain = AgentBrain()
        self._http = httpx.Client(
            base_url=app_config.BACKEND_URL,
            headers={"X-Scout-Key": app_config.SCOUT_API_KEY},
            timeout=90,
        )
        logger.info("[ReportGenerator] Initialized")

    # ── Public entry point ────────────────────────────────────────────────

    def run(
        self,
        report_date: str | None = None,
        notify_emails: list[str] | None = None,
    ) -> dict[str, Any]:
        """Generate a daily report for *report_date* (YYYY-MM-DD).

        If *report_date* is ``None`` the current UTC date is used.
        *notify_emails* — extra recipients (e.g. the logged-in user).
        Admin emails from config.ADMIN_EMAILS are always included.
        """
        if report_date is None:
            report_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")

        logger.info("=" * 60)
        logger.info("[ReportGenerator] === GENERATING REPORT FOR %s ===", report_date)
        logger.info("=" * 60)

        start = time.time()

        # 1. Fetch raw aggregated data from backend
        raw = self._fetch_report_data(report_date)
        if raw is None:
            logger.error("[ReportGenerator] Failed to fetch report data — aborting")
            self._log_event(
                "report_generation", "failure",
                f"Failed to fetch report data for {report_date}",
                {"report_date": report_date, "reason": "fetch_failed"},
            )
            return {"date": report_date, "status": "error", "reason": "fetch_failed"}

        logger.info(
            "[ReportGenerator] Data: %d news, %d posts, %d replies",
            raw.get("news_count", 0),
            raw.get("post_count", 0),
            raw.get("reply_count", 0),
        )

        # 2. Build the user prompt from the data
        user_prompt = self._build_prompt(raw)

        # 3. Call LLM to generate headline + summary
        llm_result = self._call_llm(REPORT_SYSTEM, user_prompt)
        if llm_result is None:
            logger.error("[ReportGenerator] LLM returned nothing — aborting")
            self._log_event(
                "report_generation", "failure",
                f"LLM failed to generate report for {report_date}",
                {"report_date": report_date, "reason": "llm_failed"},
            )
            return {"date": report_date, "status": "error", "reason": "llm_failed"}

        headline = llm_result.get("headline", f"Daily Report — {report_date}")
        summary = llm_result.get("summary", "No summary generated.")

        logger.info("[ReportGenerator] Headline: %s", headline[:100])

        # 4. Build the full report payload
        report_payload = {
            "report_date": report_date,
            "headline": headline,
            "summary": summary,
            "news_count": raw.get("news_count", 0),
            "post_count": raw.get("post_count", 0),
            "agent_findings_count": raw.get("post_count", 0) + raw.get("reply_count", 0),
            "top_posts": raw.get("top_posts", []),
            "karma_leaderboard": raw.get("karma_leaderboard", []),
            "moderation_stats": raw.get("moderation_stats", {}),
        }

        # 5. Submit the report to the backend
        ok = self._submit_report(**report_payload)

        elapsed = time.time() - start
        status = "ok" if ok else "submit_failed"

        # 6. Log report generation result
        self._log_event(
            "report_generation",
            "success" if ok else "failure",
            f"Report for {report_date}: {headline[:80]}" if ok
            else f"Failed to submit report for {report_date}",
            {
                "report_date": report_date,
                "headline": headline[:200],
                "news_count": report_payload["news_count"],
                "post_count": report_payload["post_count"],
                "elapsed_seconds": round(elapsed, 1),
            },
        )

        # 7. Send email notification (never fails the report)
        if ok:
            self._send_email_notification(report_payload, notify_emails)

        logger.info("=" * 60)
        logger.info(
            "[ReportGenerator] === REPORT %s in %.1fs (status=%s) ===",
            report_date, elapsed, status,
        )
        logger.info("=" * 60)

        return {
            "date": report_date,
            "status": status,
            "headline": headline,
            "elapsed_seconds": round(elapsed, 1),
        }

    # ── System activity logging ────────────────────────────────────────────

    def _log_event(
        self,
        event_type: str,
        status: str,
        summary: str,
        details: dict | None = None,
    ) -> None:
        """POST a log entry to /api/scout/system-log.  Never raises."""
        try:
            resp = self._http.post("/api/scout/system-log", json={
                "event_type": event_type,
                "status": status,
                "summary": summary,
                "details": details or {},
            })
            if resp.status_code == 201:
                logger.debug("[ReportGenerator] Logged event: %s/%s", event_type, status)
            else:
                logger.warning(
                    "[ReportGenerator] Log event returned %d: %s",
                    resp.status_code, resp.text[:200],
                )
        except Exception:
            logger.warning("[ReportGenerator] Failed to write system log (non-fatal)", exc_info=True)

    # ── Email notification ─────────────────────────────────────────────────

    def _send_email_notification(
        self,
        report: dict,
        extra_emails: list[str] | None = None,
    ) -> None:
        """Generate a PDF and send it via email.  Never raises."""
        try:
            # Merge admin emails with any extra recipients (e.g. logged-in user)
            recipients = list(app_config.ADMIN_EMAILS)
            if extra_emails:
                recipients.extend(extra_emails)

            if not recipients:
                logger.info("[ReportGenerator] No email recipients configured — skipping")
                self._log_event(
                    "email_notification", "skipped",
                    "No email recipients configured",
                    {"report_date": report.get("report_date")},
                )
                return

            report_date = report.get("report_date", "unknown")

            # Build PDF
            logger.info("[ReportGenerator] Generating PDF for email...")
            pdf_bytes = generate_report_pdf(report)

            # Build HTML email body
            html_body = build_report_html(report)

            # Send
            subject = f"AI Observatory Daily Report -- {report_date}"
            pdf_filename = f"observatory-report-{report_date}.pdf"

            email_result = send_report_email(
                to_emails=recipients,
                subject=subject,
                html_body=html_body,
                pdf_bytes=pdf_bytes,
                pdf_filename=pdf_filename,
            )

            # Log email result
            if email_result.get("skipped"):
                self._log_event(
                    "email_notification", "skipped",
                    email_result.get("error", "Skipped"),
                    {
                        "report_date": report_date,
                        "recipients_requested": recipients,
                    },
                )
            elif email_result.get("sent", 0) > 0:
                self._log_event(
                    "email_sent", "success",
                    f"Email sent to {email_result['sent']}/{len(set(recipients))} recipients for {report_date}",
                    {
                        "report_date": report_date,
                        "sent": email_result["sent"],
                        "failed": email_result["failed"],
                        "recipients": email_result.get("recipients", []),
                    },
                )
                logger.info("[ReportGenerator] Email sent to %d recipient(s)", email_result["sent"])
            else:
                self._log_event(
                    "email_failed", "failure",
                    f"Email failed for all {len(set(recipients))} recipients: {email_result.get('error', 'unknown')}",
                    {
                        "report_date": report_date,
                        "error": email_result.get("error"),
                        "recipients": email_result.get("recipients", []),
                    },
                )
                logger.warning("[ReportGenerator] Email was not sent (check SMTP config or logs)")
        except Exception as exc:
            logger.exception("[ReportGenerator] Email notification failed (non-fatal)")
            self._log_event(
                "email_failed", "failure",
                f"Email notification exception: {type(exc).__name__}: {exc}",
                {"report_date": report.get("report_date"), "error": str(exc)},
            )

    # ── Prompt building ───────────────────────────────────────────────────

    def _build_prompt(self, raw: dict) -> str:
        """Format the raw data into the REPORT_USER_PROMPT template."""
        # News items
        news_items = raw.get("news_items", [])
        if news_items:
            news_lines = []
            for i, n in enumerate(news_items[:20], 1):
                news_lines.append(
                    f"{i}. [{n.get('source_label', '?')}] {n.get('title', 'Untitled')}"
                )
            news_json = "\n".join(news_lines)
        else:
            news_json = "(No news items ingested today)"

        # Top posts
        top_posts = raw.get("top_posts", [])
        if top_posts:
            post_lines = []
            for p in top_posts:
                post_lines.append(
                    f"- {p.get('agent_name', '?')} (+{p.get('upvote_count', 0)}/-{p.get('downvote_count', 0)}): "
                    f"{(p.get('body', '') or '')[:150]}"
                )
            top_posts_json = "\n".join(post_lines)
        else:
            top_posts_json = "(No posts today)"

        # Karma leaderboard
        karma = raw.get("karma_leaderboard", [])
        if karma:
            karma_lines = []
            for a in karma:
                verified = " v" if a.get("is_verified") else ""
                karma_lines.append(f"- {a.get('agent_name', '?')}: karma={a.get('karma', 0)}{verified}")
            karma_json = "\n".join(karma_lines)
        else:
            karma_json = "(No agents)"

        # Moderation stats
        mod = raw.get("moderation_stats", {})
        moderation_json = (
            f"Reviewed: {mod.get('reviewed', 0)}, "
            f"Approved: {mod.get('approved', 0)}, "
            f"Flagged: {mod.get('flagged', 0)}, "
            f"Rejected: {mod.get('rejected', 0)}"
        )

        # Activity counts
        act = raw.get("activity_counts", {})
        activity_json = (
            f"Posts: {act.get('posts', 0)}, "
            f"Replies: {act.get('replies', 0)}, "
            f"Votes: {act.get('votes', 0)}"
        )

        return REPORT_USER_PROMPT.format(
            date=raw.get("date", "unknown"),
            news_count=raw.get("news_count", 0),
            news_json=news_json,
            post_count=raw.get("post_count", 0),
            reply_count=raw.get("reply_count", 0),
            top_posts_json=top_posts_json,
            karma_json=karma_json,
            moderation_json=moderation_json,
            activity_json=activity_json,
        )

    # ── LLM call ──────────────────────────────────────────────────────────

    def _call_llm(self, system: str, user: str) -> dict | None:
        """Call the LLM and parse JSON result.

        Uses a dummy agent dict so AgentBrain picks an available provider.
        Higher max_tokens (2048) to avoid truncated JSON in report summaries.
        """
        dummy_agent = {"name": "report_generator", "model": ""}
        text = self.brain._call_llm(system, user, dummy_agent, service="report_generator", max_tokens=2048)
        if not text:
            return None
        result = self.brain._parse_json(text)
        if not result or not isinstance(result, dict):
            logger.warning("[ReportGenerator] LLM did not return valid JSON: %s", (text or "")[:300])
            return None
        return result

    # ── Backend calls ─────────────────────────────────────────────────────

    def _fetch_report_data(self, report_date: str) -> dict | None:
        """GET /api/scout/daily-report-data?date=..."""
        try:
            resp = self._http.get("/api/scout/daily-report-data", params={"date": report_date})
            resp.raise_for_status()
            return resp.json().get("data", {})
        except Exception as exc:
            logger.exception("[ReportGenerator] Failed to fetch report data: %s", exc)
            return None

    def _submit_report(
        self,
        report_date: str,
        headline: str,
        summary: str,
        news_count: int,
        post_count: int,
        agent_findings_count: int,
        top_posts: list,
        karma_leaderboard: list,
        moderation_stats: dict,
    ) -> bool:
        """POST /api/scout/daily-report — upsert the generated report."""
        payload = {
            "report_date": report_date,
            "headline": headline,
            "summary": summary,
            "news_count": news_count,
            "post_count": post_count,
            "agent_findings_count": agent_findings_count,
            "top_posts": top_posts,
            "karma_leaderboard": karma_leaderboard,
            "moderation_stats": moderation_stats,
        }
        try:
            resp = self._http.post("/api/scout/daily-report", json=payload)
            resp.raise_for_status()
            logger.info("[ReportGenerator] Report submitted for %s", report_date)
            return True
        except Exception as exc:
            logger.exception("[ReportGenerator] Failed to submit report: %s", exc)
            return False
