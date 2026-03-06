"""Email utility for sending report notifications with PDF attachments.

Uses Python stdlib smtplib + email.mime — no extra dependencies required.

Design principles:
  - NEVER raises — all errors are logged and swallowed.
  - Silently skips if SMTP credentials are not configured.
  - Deduplicates and filters empty/whitespace recipient addresses.
  - Returns a rich result dict with per-recipient status for logging.
"""

from __future__ import annotations

import logging
import smtplib
import traceback
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any, Sequence

import config as app_config

logger = logging.getLogger(__name__)


def _smtp_configured() -> bool:
    """Return True if all required SMTP settings are present."""
    return bool(
        app_config.SMTP_HOST
        and app_config.SMTP_USER
        and app_config.SMTP_PASSWORD
    )


def send_report_email(
    to_emails: Sequence[str],
    subject: str,
    html_body: str,
    pdf_bytes: bytes | None = None,
    pdf_filename: str = "report.pdf",
) -> dict[str, Any]:
    """Send an HTML email with an optional PDF attachment.

    Each recipient is sent to **individually** so that one invalid or
    bouncing address never prevents delivery to the other recipients.

    Returns
    -------
    dict with keys:
      - sent: int — number of successfully sent emails
      - failed: int — number of failed sends
      - skipped: bool — True if sending was skipped entirely (no SMTP config or no recipients)
      - recipients: list of dicts with {email, status, error?}
      - error: str | None — connection-level error if SMTP server couldn't be reached
    Never raises.
    """
    result: dict[str, Any] = {
        "sent": 0,
        "failed": 0,
        "skipped": False,
        "recipients": [],
        "error": None,
    }

    if not _smtp_configured():
        logger.info("[Email] SMTP not configured — skipping email send")
        result["skipped"] = True
        result["error"] = "SMTP not configured (missing SMTP_HOST, SMTP_USER, or SMTP_PASSWORD)"
        return result

    # Deduplicate, strip, and filter empty
    recipients = list({e.strip() for e in to_emails if e and e.strip()})
    if not recipients:
        logger.info("[Email] No recipients — skipping email send")
        result["skipped"] = True
        result["error"] = "No valid recipients provided"
        return result

    # Build the message once (we'll update the To header per recipient)
    from_addr = app_config.SMTP_FROM or app_config.SMTP_USER

    def _build_msg(recipient: str) -> MIMEMultipart:
        msg = MIMEMultipart("mixed")
        msg["Subject"] = subject
        msg["From"] = from_addr
        msg["To"] = recipient
        msg.attach(MIMEText(html_body, "html", "utf-8"))
        if pdf_bytes:
            part = MIMEApplication(pdf_bytes, _subtype="pdf")
            part.add_header(
                "Content-Disposition", "attachment", filename=pdf_filename,
            )
            msg.attach(part)
        return msg

    try:
        logger.info(
            "[Email] Connecting to %s:%s ...", app_config.SMTP_HOST, app_config.SMTP_PORT,
        )
        with smtplib.SMTP(app_config.SMTP_HOST, app_config.SMTP_PORT, timeout=30) as server:
            server.ehlo()
            server.starttls()
            server.ehlo()
            server.login(app_config.SMTP_USER, app_config.SMTP_PASSWORD)

            # Send to each recipient individually
            for recipient in recipients:
                try:
                    msg = _build_msg(recipient)
                    server.sendmail(app_config.SMTP_USER, [recipient], msg.as_string())
                    result["sent"] += 1
                    result["recipients"].append({"email": recipient, "status": "sent"})
                    logger.info("[Email] Sent to %s", recipient)
                except Exception as exc:
                    result["failed"] += 1
                    error_msg = str(exc)
                    result["recipients"].append({
                        "email": recipient,
                        "status": "failed",
                        "error": error_msg,
                    })
                    logger.warning("[Email] Failed to send to %s: %s", recipient, error_msg)

    except Exception as exc:
        # Connection-level failure (can't reach SMTP server at all)
        error_msg = f"{type(exc).__name__}: {exc}"
        tb = traceback.format_exc()
        logger.exception("[Email] Failed to connect to SMTP server (non-fatal)")
        result["error"] = error_msg
        result["failed"] = len(recipients)
        result["recipients"] = [
            {"email": r, "status": "failed", "error": f"SMTP connection failed: {error_msg}"}
            for r in recipients
        ]
        return result

    logger.info("[Email] Done: %d sent, %d failed out of %d recipients",
                result["sent"], result["failed"], len(recipients))
    return result


def build_report_html(report: dict) -> str:
    """Build a simple, attractive HTML email body from the report data."""
    report_date = report.get("report_date", "N/A")
    headline = report.get("headline", f"Daily Report -- {report_date}")
    summary = (report.get("summary") or "No summary available.").replace("\n", "<br>")
    news_count = report.get("news_count", 0)
    post_count = report.get("post_count", 0)
    activity = report.get("agent_findings_count", 0)

    # Top posts section
    top_posts_html = ""
    for i, p in enumerate(report.get("top_posts", [])[:5], 1):
        agent = p.get("agent_name", "Unknown")
        body = (p.get("body") or "")[:200]
        ups = p.get("upvote_count", p.get("upvotes", 0))
        downs = p.get("downvote_count", p.get("downvotes", 0))
        top_posts_html += f"""
        <tr>
          <td style="padding:8px;border-bottom:1px solid #E2E8F0;">{i}</td>
          <td style="padding:8px;border-bottom:1px solid #E2E8F0;font-weight:bold;">{agent}</td>
          <td style="padding:8px;border-bottom:1px solid #E2E8F0;">{body}</td>
          <td style="padding:8px;border-bottom:1px solid #E2E8F0;color:#22C55E;">+{ups}</td>
          <td style="padding:8px;border-bottom:1px solid #E2E8F0;color:#EF4444;">-{downs}</td>
        </tr>"""

    # Karma leaderboard
    karma_html = ""
    for i, a in enumerate(report.get("karma_leaderboard", [])[:5], 1):
        name = a.get("agent_name", a.get("name", "?"))
        karma = a.get("karma", 0)
        verified = '<span style="color:#22C55E;">&#10003; Verified</span>' if a.get("is_verified") else "--"
        karma_html += f"""
        <tr>
          <td style="padding:6px;border-bottom:1px solid #E2E8F0;">#{i}</td>
          <td style="padding:6px;border-bottom:1px solid #E2E8F0;">{name}</td>
          <td style="padding:6px;border-bottom:1px solid #E2E8F0;font-weight:bold;color:#8B5CF6;">{karma}</td>
          <td style="padding:6px;border-bottom:1px solid #E2E8F0;">{verified}</td>
        </tr>"""

    return f"""
    <html>
    <body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;background:#F1F5F9;">
      <div style="max-width:640px;margin:20px auto;background:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

        <!-- Header -->
        <div style="background:#0F172A;padding:28px 32px;">
          <div style="color:#8B5CF6;font-size:12px;font-weight:bold;letter-spacing:1px;">AI OBSERVATORY</div>
          <div style="color:#C8C8DC;font-size:10px;margin-top:2px;">DAILY INTELLIGENCE REPORT</div>
          <div style="color:#FFFFFF;font-size:20px;font-weight:bold;margin-top:12px;line-height:1.3;">{headline}</div>
          <div style="color:#B4B4C8;font-size:11px;margin-top:8px;">Report Date: {report_date}</div>
        </div>

        <!-- Accent bar -->
        <div style="height:4px;background:linear-gradient(to right,#EC4899,#8B5CF6);"></div>

        <!-- Stats -->
        <div style="padding:24px 32px;display:flex;gap:12px;">
          <table width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="text-align:center;background:#F8FAFC;border-radius:8px;padding:16px;border-top:3px solid #8B5CF6;">
              <div style="font-size:26px;font-weight:bold;color:#8B5CF6;">{news_count}</div>
              <div style="font-size:10px;color:#64748B;margin-top:4px;">NEWS INGESTED</div>
            </td>
            <td width="12"></td>
            <td style="text-align:center;background:#F8FAFC;border-radius:8px;padding:16px;border-top:3px solid #EC4899;">
              <div style="font-size:26px;font-weight:bold;color:#EC4899;">{post_count}</div>
              <div style="font-size:10px;color:#64748B;margin-top:4px;">AGENT POSTS</div>
            </td>
            <td width="12"></td>
            <td style="text-align:center;background:#F8FAFC;border-radius:8px;padding:16px;border-top:3px solid #22C55E;">
              <div style="font-size:26px;font-weight:bold;color:#22C55E;">{activity}</div>
              <div style="font-size:10px;color:#64748B;margin-top:4px;">TOTAL ACTIVITY</div>
            </td>
          </tr></table>
        </div>

        <!-- Summary -->
        <div style="padding:0 32px 24px;">
          <div style="display:flex;align-items:center;margin-bottom:12px;">
            <div style="width:4px;height:18px;background:#8B5CF6;border-radius:2px;margin-right:10px;display:inline-block;"></div>
            <span style="font-size:16px;font-weight:bold;color:#0F172A;">Executive Summary</span>
          </div>
          <div style="font-size:14px;color:#1E293B;line-height:1.6;">{summary}</div>
        </div>

        {"" if not top_posts_html else f'''
        <!-- Top Posts -->
        <div style="padding:0 32px 24px;">
          <div style="display:flex;align-items:center;margin-bottom:12px;">
            <div style="width:4px;height:18px;background:#EC4899;border-radius:2px;margin-right:10px;display:inline-block;"></div>
            <span style="font-size:16px;font-weight:bold;color:#0F172A;">Top Posts</span>
          </div>
          <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;color:#1E293B;">
            <tr style="background:#F8FAFC;">
              <th style="padding:8px;text-align:left;">#</th>
              <th style="padding:8px;text-align:left;">Agent</th>
              <th style="padding:8px;text-align:left;">Post</th>
              <th style="padding:8px;text-align:left;">Up</th>
              <th style="padding:8px;text-align:left;">Down</th>
            </tr>
            {top_posts_html}
          </table>
        </div>
        '''}

        {"" if not karma_html else f'''
        <!-- Karma Leaderboard -->
        <div style="padding:0 32px 24px;">
          <div style="display:flex;align-items:center;margin-bottom:12px;">
            <div style="width:4px;height:18px;background:#22C55E;border-radius:2px;margin-right:10px;display:inline-block;"></div>
            <span style="font-size:16px;font-weight:bold;color:#0F172A;">Karma Leaderboard</span>
          </div>
          <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;color:#1E293B;">
            <tr style="background:#F8FAFC;">
              <th style="padding:6px;text-align:left;">Rank</th>
              <th style="padding:6px;text-align:left;">Agent</th>
              <th style="padding:6px;text-align:left;">Karma</th>
              <th style="padding:6px;text-align:left;">Status</th>
            </tr>
            {karma_html}
          </table>
        </div>
        '''}

        <!-- Footer -->
        <div style="padding:16px 32px;background:#F8FAFC;border-top:1px solid #E2E8F0;text-align:center;">
          <div style="font-size:11px;color:#64748B;">
            AI Observatory &mdash; Automated Daily Intelligence Report
          </div>
          <div style="font-size:10px;color:#94A3B8;margin-top:4px;">
            The PDF report is attached to this email.
          </div>
        </div>

      </div>
    </body>
    </html>
    """
