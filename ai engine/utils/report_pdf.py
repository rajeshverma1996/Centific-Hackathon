"""Server-side PDF generation for daily reports using ReportLab.

Produces a styled A4 PDF matching the frontend design:
  - Dark header banner with title + date
  - Coloured stat cards
  - Executive Summary
  - Top Posts
  - Karma Leaderboard table
  - Moderation Overview
  - Footer on every page
"""

from __future__ import annotations

import io
import logging
from datetime import datetime
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen.canvas import Canvas
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import Paragraph
from reportlab.lib.enums import TA_LEFT

logger = logging.getLogger(__name__)

# ── Colour palette ───────────────────────────────────────────────────────────
_PURPLE = colors.HexColor("#8B5CF6")
_PINK = colors.HexColor("#EC4899")
_GREEN = colors.HexColor("#22C55E")
_AMBER = colors.HexColor("#F59E0B")
_RED = colors.HexColor("#EF4444")
_DARK = colors.HexColor("#0F172A")
_TEXT = colors.HexColor("#1E293B")
_MUTED = colors.HexColor("#64748B")
_CARD_BG = colors.HexColor("#F8FAFC")
_WHITE = colors.white

PAGE_W, PAGE_H = A4  # 595.28 x 841.89 pts
MARGIN = 50


def _safe(text: str) -> str:
    """Replace problematic Unicode chars with ASCII equivalents."""
    return (
        text
        .replace("\u2018", "'").replace("\u2019", "'").replace("\u201A", "'")
        .replace("\u201C", '"').replace("\u201D", '"').replace("\u201E", '"')
        .replace("\u2013", "-").replace("\u2014", "--")
        .replace("\u2026", "...")
        .replace("\u25C9", "*").replace("\u2022", "*").replace("\u25CF", "*")
        .replace("\u2713", "v").replace("\u2714", "v")
    )


def generate_report_pdf(report: dict[str, Any]) -> bytes:
    """Return raw PDF bytes for the given report dict."""
    buf = io.BytesIO()
    c = Canvas(buf, pagesize=A4)
    content_w = PAGE_W - MARGIN * 2

    y = PAGE_H  # current vertical position (top-down)

    # ═════════════════════════════════════════════════════════════════════════
    # HEADER BANNER
    # ═════════════════════════════════════════════════════════════════════════
    header_h = 110
    # Dark background
    c.setFillColor(_DARK)
    c.rect(0, PAGE_H - header_h, PAGE_W, header_h, fill=True, stroke=False)
    # Accent bar
    c.setFillColor(_PURPLE)
    c.rect(0, PAGE_H - header_h, PAGE_W, 8, fill=True, stroke=False)
    c.setFillColor(_PINK)
    c.rect(0, PAGE_H - header_h, PAGE_W * 0.35, 4, fill=True, stroke=False)

    # Title
    c.setFillColor(_WHITE)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(MARGIN, PAGE_H - 30, "AI OBSERVATORY")
    c.setFont("Helvetica", 9)
    c.setFillColor(colors.HexColor("#C8C8DC"))
    c.drawString(MARGIN, PAGE_H - 42, "DAILY INTELLIGENCE REPORT")

    # Date (right-aligned)
    report_date = report.get("report_date", "")
    try:
        date_display = datetime.strptime(report_date, "%Y-%m-%d").strftime("%A, %B %d, %Y")
    except Exception:
        date_display = report_date

    c.setFillColor(_WHITE)
    c.setFont("Helvetica-Bold", 12)
    c.drawRightString(PAGE_W - MARGIN, PAGE_H - 30, date_display)

    created_at = report.get("created_at", "")
    if created_at:
        try:
            gen_dt = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
            gen_display = gen_dt.strftime("Generated: %A, %B %d, %Y at %I:%M %p")
        except Exception:
            gen_display = f"Generated: {created_at}"
        c.setFont("Helvetica", 7)
        c.setFillColor(colors.HexColor("#B4B4C8"))
        c.drawRightString(PAGE_W - MARGIN, PAGE_H - 42, gen_display)

    # Headline
    headline = _safe(report.get("headline", f"Daily Report -- {report_date}"))
    c.setFillColor(_WHITE)
    c.setFont("Helvetica-Bold", 16)
    # Wrap headline if too long
    headline_lines = _wrap_text(c, headline, content_w, "Helvetica-Bold", 16)
    hy = PAGE_H - 65
    for hl in headline_lines[:2]:
        c.drawString(MARGIN, hy, hl)
        hy -= 20

    y = PAGE_H - header_h - 15

    # ═════════════════════════════════════════════════════════════════════════
    # STAT CARDS
    # ═════════════════════════════════════════════════════════════════════════
    stats = [
        ("NEWS INGESTED", report.get("news_count", 0), _PURPLE),
        ("AGENT POSTS", report.get("post_count", 0), _PINK),
        ("TOTAL ACTIVITY", report.get("agent_findings_count", 0), _GREEN),
    ]

    card_w = (content_w - 20) / 3
    card_h = 55
    for i, (label, value, colour) in enumerate(stats):
        cx = MARGIN + i * (card_w + 10)
        cy = y - card_h

        # Card bg
        c.setFillColor(_CARD_BG)
        c.roundRect(cx, cy, card_w, card_h, 6, fill=True, stroke=False)

        # Colour bar at top
        c.setFillColor(colour)
        c.rect(cx, cy + card_h - 6, card_w, 6, fill=True, stroke=False)

        # Value
        c.setFillColor(colour)
        c.setFont("Helvetica-Bold", 22)
        c.drawCentredString(cx + card_w / 2, cy + 20, str(value))

        # Label
        c.setFillColor(_MUTED)
        c.setFont("Helvetica", 7)
        c.drawCentredString(cx + card_w / 2, cy + 8, label)

    y -= card_h + 20

    # ═════════════════════════════════════════════════════════════════════════
    # EXECUTIVE SUMMARY
    # ═════════════════════════════════════════════════════════════════════════
    summary = report.get("summary", "")
    if summary:
        y = _check_page(c, y, 60)

        # Section heading
        c.setFillColor(_PURPLE)
        c.roundRect(MARGIN, y - 12, 4, 14, 2, fill=True, stroke=False)
        c.setFillColor(_DARK)
        c.setFont("Helvetica-Bold", 13)
        c.drawString(MARGIN + 10, y - 8, "Executive Summary")
        y -= 25

        # Body paragraphs
        c.setFont("Helvetica", 10)
        c.setFillColor(_TEXT)
        for para in _safe(summary).split("\n"):
            para = para.strip()
            if not para:
                continue
            lines = _wrap_text(c, para, content_w - 8, "Helvetica", 10)
            for line in lines:
                y = _check_page(c, y, 14)
                c.drawString(MARGIN + 4, y, line)
                y -= 14
            y -= 6

    # ═════════════════════════════════════════════════════════════════════════
    # TOP POSTS
    # ═════════════════════════════════════════════════════════════════════════
    top_posts = report.get("top_posts", [])
    if top_posts:
        y -= 8
        y = _check_page(c, y, 40)

        c.setFillColor(_PINK)
        c.roundRect(MARGIN, y - 12, 4, 14, 2, fill=True, stroke=False)
        c.setFillColor(_DARK)
        c.setFont("Helvetica-Bold", 13)
        c.drawString(MARGIN + 10, y - 8, "Top Posts")
        y -= 25

        for idx, post in enumerate(top_posts[:5]):
            y = _check_page(c, y, 50)

            agent_name = _safe(str(post.get("agent_name", "Unknown")))
            body = _safe(str(post.get("body", "")))
            upvotes = post.get("upvote_count", post.get("upvotes", 0))
            downvotes = post.get("downvote_count", post.get("downvotes", 0))

            # Rank + agent name
            c.setFont("Helvetica-Bold", 10)
            c.setFillColor(_DARK)
            c.drawString(MARGIN + 4, y, f"{idx + 1}. {agent_name}")

            # Vote badges
            vote_text = f"+{upvotes} / -{downvotes}"
            vx = MARGIN + 8 + c.stringWidth(f"{idx + 1}. {agent_name}", "Helvetica-Bold", 10)
            c.setFillColor(_GREEN)
            c.setFont("Helvetica-Bold", 8)
            c.drawString(vx + 6, y + 1, vote_text)
            y -= 14

            # Post body (truncated)
            c.setFont("Helvetica", 9)
            c.setFillColor(_TEXT)
            body_lines = _wrap_text(c, body[:300], content_w - 16, "Helvetica", 9)
            for bl in body_lines[:4]:
                y = _check_page(c, y, 12)
                c.drawString(MARGIN + 12, y, bl)
                y -= 12
            y -= 8

    # ═════════════════════════════════════════════════════════════════════════
    # KARMA LEADERBOARD
    # ═════════════════════════════════════════════════════════════════════════
    karma_lb = report.get("karma_leaderboard", [])
    if karma_lb:
        y -= 8
        y = _check_page(c, y, 50)

        c.setFillColor(_GREEN)
        c.roundRect(MARGIN, y - 12, 4, 14, 2, fill=True, stroke=False)
        c.setFillColor(_DARK)
        c.setFont("Helvetica-Bold", 13)
        c.drawString(MARGIN + 10, y - 8, "Karma Leaderboard")
        y -= 22

        # Table header
        row_h = 20
        c.setFillColor(_DARK)
        c.roundRect(MARGIN, y - row_h + 4, content_w, row_h, 4, fill=True, stroke=False)
        c.setFillColor(_WHITE)
        c.setFont("Helvetica-Bold", 8)
        c.drawString(MARGIN + 8, y - 8, "RANK")
        c.drawString(MARGIN + 50, y - 8, "AGENT")
        c.drawString(MARGIN + content_w - 100, y - 8, "KARMA")
        c.drawString(MARGIN + content_w - 50, y - 8, "STATUS")
        y -= row_h + 2

        for idx, agent in enumerate(karma_lb[:10]):
            y = _check_page(c, y, 18)

            bg = _CARD_BG if idx % 2 == 0 else _WHITE
            c.setFillColor(bg)
            c.roundRect(MARGIN, y - 14, content_w, 18, 2, fill=True, stroke=False)

            c.setFont("Helvetica-Bold", 9)
            c.setFillColor(_DARK if idx < 3 else _MUTED)
            c.drawString(MARGIN + 8, y - 8, f"#{idx + 1}")

            c.setFont("Helvetica", 9)
            c.setFillColor(_TEXT)
            c.drawString(MARGIN + 50, y - 8, _safe(str(agent.get("agent_name", agent.get("name", "?")))))

            c.setFont("Helvetica-Bold", 9)
            c.setFillColor(_PURPLE)
            c.drawString(MARGIN + content_w - 100, y - 8, str(agent.get("karma", 0)))

            is_verified = agent.get("is_verified", False)
            if is_verified:
                c.setFillColor(_GREEN)
                c.roundRect(MARGIN + content_w - 58, y - 12, 40, 14, 4, fill=True, stroke=False)
                c.setFillColor(_WHITE)
                c.setFont("Helvetica-Bold", 7)
                c.drawCentredString(MARGIN + content_w - 38, y - 8, "VERIFIED")
            else:
                c.setFillColor(_MUTED)
                c.setFont("Helvetica", 7)
                c.drawCentredString(MARGIN + content_w - 38, y - 8, "--")

            y -= 20

    # ═════════════════════════════════════════════════════════════════════════
    # MODERATION STATS
    # ═════════════════════════════════════════════════════════════════════════
    mod = report.get("moderation_stats", {})
    if mod and any(mod.get(k) for k in ("reviewed", "approved", "flagged", "rejected")):
        y -= 12
        y = _check_page(c, y, 60)

        c.setFillColor(_AMBER)
        c.roundRect(MARGIN, y - 12, 4, 14, 2, fill=True, stroke=False)
        c.setFillColor(_DARK)
        c.setFont("Helvetica-Bold", 13)
        c.drawString(MARGIN + 10, y - 8, "Moderation Overview")
        y -= 25

        mod_stats = [
            ("Reviewed", mod.get("reviewed", 0), _PURPLE),
            ("Approved", mod.get("approved", 0), _GREEN),
            ("Flagged", mod.get("flagged", 0), _AMBER),
            ("Rejected", mod.get("rejected", 0), _RED),
        ]
        mod_w = (content_w - 30) / 4
        mod_h = 45
        for i, (label, val, colour) in enumerate(mod_stats):
            mx = MARGIN + i * (mod_w + 10)
            my = y - mod_h
            c.setFillColor(_CARD_BG)
            c.roundRect(mx, my, mod_w, mod_h, 4, fill=True, stroke=False)

            c.setFillColor(colour)
            c.setFont("Helvetica-Bold", 18)
            c.drawCentredString(mx + mod_w / 2, my + 22, str(val))

            c.setFillColor(_MUTED)
            c.setFont("Helvetica", 7)
            c.drawCentredString(mx + mod_w / 2, my + 8, label.upper())

        y -= mod_h + 10

    # ═════════════════════════════════════════════════════════════════════════
    # FOOTER (all pages)
    # ═════════════════════════════════════════════════════════════════════════
    total_pages = c.getPageNumber()
    _draw_footer(c, total_pages)
    c.save()

    # Add footers to all pages (re-iterate is not needed — we drew inline)
    pdf_bytes = buf.getvalue()
    buf.close()
    return pdf_bytes


# ── Helpers ──────────────────────────────────────────────────────────────────

def _wrap_text(c: Canvas, text: str, max_width: float, font: str, size: float) -> list[str]:
    """Word-wrap *text* to fit within *max_width* using the given font."""
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        test = f"{current} {word}".strip()
        if c.stringWidth(test, font, size) <= max_width:
            current = test
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines or [""]


def _check_page(c: Canvas, y: float, needed: float) -> float:
    """If there's not enough room, start a new page and return fresh y."""
    if y - needed < 40:
        _draw_footer(c, c.getPageNumber())
        c.showPage()
        return PAGE_H - MARGIN
    return y


def _draw_footer(c: Canvas, page_num: int) -> None:
    """Draw a footer line at the bottom of the current page."""
    fy = 30
    c.setStrokeColor(colors.HexColor("#E2E8F0"))
    c.setLineWidth(0.3)
    c.line(MARGIN, fy + 4, PAGE_W - MARGIN, fy + 4)
    c.setFillColor(_MUTED)
    c.setFont("Helvetica", 7)
    c.drawString(MARGIN, fy - 4, "AI Observatory -- Automated Daily Intelligence Report")
    c.drawRightString(PAGE_W - MARGIN, fy - 4, f"Page {page_num}")

