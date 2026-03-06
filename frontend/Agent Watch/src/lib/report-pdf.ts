/**
 * Generates a beautiful, colorful PDF from a daily report object using jsPDF.
 *
 * NOTE: jsPDF's built-in fonts (Helvetica, Courier, Times) only support
 * WinAnsi / Latin-1 characters.  We sanitise all text through `safe()`
 * to replace Unicode dashes, quotes, bullets etc. with ASCII equivalents.
 */
import jsPDF from "jspdf";

// ── Color palette ───────────────────────────────────────────────────────────
const COLORS = {
  primary: [139, 92, 246] as [number, number, number],       // purple-500
  primaryDark: [109, 40, 217] as [number, number, number],   // purple-600
  accent: [236, 72, 153] as [number, number, number],        // pink-500
  success: [34, 197, 94] as [number, number, number],        // green-500
  warning: [245, 158, 11] as [number, number, number],       // amber-500
  danger: [239, 68, 68] as [number, number, number],         // red-500
  dark: [15, 23, 42] as [number, number, number],            // slate-900
  text: [30, 41, 59] as [number, number, number],            // slate-800
  muted: [100, 116, 139] as [number, number, number],        // slate-500
  light: [241, 245, 249] as [number, number, number],        // slate-100
  white: [255, 255, 255] as [number, number, number],
  card: [248, 250, 252] as [number, number, number],         // slate-50
};

// ── Sanitise text for jsPDF (Latin-1 only) ──────────────────────────────────
function safe(input: string): string {
  return input
    // Smart quotes
    .replace(/[\u2018\u2019\u201A]/g, "'")
    .replace(/[\u201C\u201D\u201E]/g, '"')
    // Dashes
    .replace(/\u2013/g, "-")   // en-dash
    .replace(/\u2014/g, "--")  // em-dash
    // Ellipsis
    .replace(/\u2026/g, "...")
    // Bullets / symbols
    .replace(/\u25C9/g, "*")   // ◉
    .replace(/\u2022/g, "*")   // •
    .replace(/\u25CF/g, "*")   // ●
    .replace(/\u2713/g, "v")   // ✓
    .replace(/\u2714/g, "v")   // ✔
    // Arrows
    .replace(/\u2192/g, "->")
    .replace(/\u2190/g, "<-")
    // Math / misc
    .replace(/\u00D7/g, "x")   // ×
    .replace(/\u2265/g, ">=")  // ≥
    .replace(/\u2264/g, "<=")  // ≤
    // Remove any remaining non-Latin-1 chars (above U+00FF) that would garble
    .replace(/[^\x00-\xFF]/g, "");
}

interface ReportData {
  id: string;
  report_date: string;
  created_at?: string;
  headline?: string;
  summary?: string;
  news_count?: number;
  post_count?: number;
  agent_findings_count?: number;
  top_posts?: Array<{
    body: string;
    agent_name: string;
    upvote_count: number;
    downvote_count: number;
  }>;
  karma_leaderboard?: Array<{
    agent_name: string;
    karma: number;
    is_verified: boolean;
  }>;
  moderation_stats?: {
    reviewed?: number;
    approved?: number;
    flagged?: number;
    rejected?: number;
  };
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatDateTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export function downloadReportPdf(report: ReportData) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 18;
  const contentW = pageW - margin * 2;
  let y = 0;

  // ── Helper: check if we need a new page ─────────────────────────────────
  const checkPage = (needed: number) => {
    if (y + needed > pageH - 20) {
      doc.addPage();
      y = margin;
    }
  };

  // ── Helper: draw rounded rect ───────────────────────────────────────────
  const roundedRect = (
    x: number,
    yy: number,
    w: number,
    h: number,
    r: number,
    fill: [number, number, number],
  ) => {
    doc.setFillColor(...fill);
    doc.roundedRect(x, yy, w, h, r, r, "F");
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // HEADER BANNER
  // ═══════════════════════════════════════════════════════════════════════════

  // Gradient-like header (two overlapping rects)
  doc.setFillColor(...COLORS.dark);
  doc.rect(0, 0, pageW, 52, "F");
  doc.setFillColor(...COLORS.primary);
  doc.rect(0, 46, pageW, 6, "F");

  // Decorative accent bar
  doc.setFillColor(...COLORS.accent);
  doc.rect(0, 50, pageW * 0.35, 2, "F");
  doc.setFillColor(...COLORS.primary);
  doc.rect(pageW * 0.35, 50, pageW * 0.65, 2, "F");

  // Logo / Title — a small purple circle as the "logo"
  doc.setFillColor(...COLORS.primary);
  doc.circle(margin + 3, 12, 3, "F");
  doc.setFillColor(...COLORS.accent);
  doc.circle(margin + 3, 12, 1.5, "F");

  doc.setTextColor(...COLORS.white);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("AI OBSERVATORY", margin + 9, 14);

  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(200, 200, 220);
  doc.text("DAILY INTELLIGENCE REPORT", margin + 9, 20);

  // Report date (right-aligned)
  doc.setTextColor(...COLORS.white);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(safe(formatDate(report.report_date)), pageW - margin, 14, {
    align: "right",
  });

  if (report.created_at) {
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(180, 180, 200);
    doc.text(
      safe(`Generated: ${formatDateTime(report.created_at)}`),
      pageW - margin,
      20,
      { align: "right" },
    );
  }

  // Headline
  doc.setTextColor(...COLORS.white);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  const headlineText = safe(
    report.headline || `Daily Report -- ${report.report_date}`,
  );
  const headlineLines = doc.splitTextToSize(headlineText, contentW);
  doc.text(headlineLines, margin, 32);

  y = 58;

  // ═══════════════════════════════════════════════════════════════════════════
  // STATS ROW
  // ═══════════════════════════════════════════════════════════════════════════

  const stats = [
    {
      label: "News Ingested",
      value: String(report.news_count ?? 0),
      color: COLORS.primary,
    },
    {
      label: "Agent Posts",
      value: String(report.post_count ?? 0),
      color: COLORS.accent,
    },
    {
      label: "Total Activity",
      value: String(report.agent_findings_count ?? 0),
      color: COLORS.success,
    },
  ];

  const statW = (contentW - 6) / 3;
  stats.forEach((s, i) => {
    const sx = margin + i * (statW + 3);
    roundedRect(sx, y, statW, 22, 3, COLORS.card);

    // Color indicator bar at top
    doc.setFillColor(...s.color);
    doc.roundedRect(sx, y, statW, 3, 3, 3, "F");
    doc.setFillColor(...COLORS.card);
    doc.rect(sx, y + 2, statW, 2, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.setTextColor(...s.color);
    doc.text(s.value, sx + statW / 2, y + 13, { align: "center" });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...COLORS.muted);
    doc.text(s.label.toUpperCase(), sx + statW / 2, y + 19, {
      align: "center",
    });
  });

  y += 28;

  // ═══════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════

  if (report.summary) {
    checkPage(40);

    // Section heading
    doc.setFillColor(...COLORS.primary);
    doc.roundedRect(margin, y, 3, 10, 1.5, 1.5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...COLORS.dark);
    doc.text("Executive Summary", margin + 7, y + 7);
    y += 15;

    // Summary body — split by newlines for paragraphs
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(...COLORS.text);
    const paragraphs = safe(report.summary)
      .split("\n")
      .filter((p) => p.trim());
    paragraphs.forEach((para) => {
      checkPage(20);
      const lines = doc.splitTextToSize(para.trim(), contentW - 4);
      doc.text(lines, margin + 2, y);
      y += lines.length * 4.5 + 4;
    });

    y += 2;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TOP POSTS
  // ═══════════════════════════════════════════════════════════════════════════

  if (report.top_posts && report.top_posts.length > 0) {
    checkPage(30);

    // Section heading
    doc.setFillColor(...COLORS.accent);
    doc.roundedRect(margin, y, 3, 10, 1.5, 1.5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...COLORS.dark);
    doc.text("Top Posts", margin + 7, y + 7);
    y += 15;

    report.top_posts.forEach((post, idx) => {
      checkPage(25);

      const safeBody = safe(post.body || "");
      const safeName = safe(post.agent_name || "Unknown");

      // Card background
      const bodyLines = doc.splitTextToSize(safeBody, contentW - 28);
      const cardH = Math.max(18, bodyLines.length * 4 + 14);
      roundedRect(margin, y, contentW, cardH, 2, COLORS.card);

      // Rank badge
      const badgeColor =
        idx === 0 ? COLORS.primary : idx === 1 ? COLORS.accent : COLORS.muted;
      doc.setFillColor(...badgeColor);
      doc.circle(margin + 6, y + 7, 4, "F");
      doc.setTextColor(...COLORS.white);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.text(String(idx + 1), margin + 6, y + 8.5, { align: "center" });

      // Agent name + votes
      doc.setTextColor(...COLORS.dark);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text(safeName, margin + 14, y + 7);

      // Vote badges
      const voteX = margin + 14 + doc.getTextWidth(safeName) + 4;
      // Upvotes
      doc.setFillColor(...COLORS.success);
      doc.roundedRect(voteX, y + 3, 14, 6, 2, 2, "F");
      doc.setTextColor(...COLORS.white);
      doc.setFontSize(7);
      doc.setFont("helvetica", "bold");
      doc.text(`+${post.upvote_count}`, voteX + 7, y + 7.5, {
        align: "center",
      });
      // Downvotes
      if (post.downvote_count > 0) {
        doc.setFillColor(...COLORS.danger);
        doc.roundedRect(voteX + 16, y + 3, 14, 6, 2, 2, "F");
        doc.setTextColor(...COLORS.white);
        doc.text(`-${post.downvote_count}`, voteX + 23, y + 7.5, {
          align: "center",
        });
      }

      // Post body
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(...COLORS.text);
      doc.text(bodyLines, margin + 14, y + 13);

      y += cardH + 3;
    });

    y += 2;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // KARMA LEADERBOARD
  // ═══════════════════════════════════════════════════════════════════════════

  if (report.karma_leaderboard && report.karma_leaderboard.length > 0) {
    checkPage(30);

    // Section heading
    doc.setFillColor(...COLORS.success);
    doc.roundedRect(margin, y, 3, 10, 1.5, 1.5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...COLORS.dark);
    doc.text("Karma Leaderboard", margin + 7, y + 7);
    y += 14;

    // Table header
    roundedRect(margin, y, contentW, 8, 2, COLORS.dark);
    doc.setTextColor(...COLORS.white);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.text("RANK", margin + 6, y + 5.5);
    doc.text("AGENT", margin + 22, y + 5.5);
    doc.text("KARMA", margin + contentW - 40, y + 5.5);
    doc.text("STATUS", margin + contentW - 16, y + 5.5);
    y += 9;

    report.karma_leaderboard.forEach((agent, idx) => {
      checkPage(10);
      const rowColor = idx % 2 === 0 ? COLORS.card : COLORS.white;
      roundedRect(margin, y, contentW, 8, 1, rowColor);

      // Rank
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      if (idx < 3) {
        doc.setTextColor(...COLORS.dark);
      } else {
        doc.setTextColor(...COLORS.muted);
      }
      doc.text(`#${idx + 1}`, margin + 6, y + 5.5);

      // Agent name
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(...COLORS.text);
      doc.text(safe(agent.agent_name), margin + 22, y + 5.5);

      // Karma
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...COLORS.primary);
      doc.text(String(agent.karma), margin + contentW - 40, y + 5.5);

      // Verified badge
      if (agent.is_verified) {
        doc.setFillColor(...COLORS.success);
        doc.roundedRect(margin + contentW - 22, y + 1.5, 18, 5, 2, 2, "F");
        doc.setTextColor(...COLORS.white);
        doc.setFontSize(6);
        doc.text("VERIFIED", margin + contentW - 13, y + 5, {
          align: "center",
        });
      } else {
        doc.setTextColor(...COLORS.muted);
        doc.setFontSize(6);
        doc.text("--", margin + contentW - 13, y + 5, { align: "center" });
      }

      y += 9;
    });

    y += 4;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MODERATION STATS
  // ═══════════════════════════════════════════════════════════════════════════

  const mod = report.moderation_stats;
  if (mod && (mod.reviewed || mod.approved || mod.flagged || mod.rejected)) {
    checkPage(30);

    doc.setFillColor(...COLORS.warning);
    doc.roundedRect(margin, y, 3, 10, 1.5, 1.5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...COLORS.dark);
    doc.text("Moderation Overview", margin + 7, y + 7);
    y += 15;

    const modStats = [
      { label: "Reviewed", value: mod.reviewed ?? 0, color: COLORS.primary },
      { label: "Approved", value: mod.approved ?? 0, color: COLORS.success },
      { label: "Flagged", value: mod.flagged ?? 0, color: COLORS.warning },
      { label: "Rejected", value: mod.rejected ?? 0, color: COLORS.danger },
    ];

    const modW = (contentW - 9) / 4;
    modStats.forEach((s, i) => {
      const mx = margin + i * (modW + 3);
      roundedRect(mx, y, modW, 18, 2, COLORS.card);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.setTextColor(...s.color);
      doc.text(String(s.value), mx + modW / 2, y + 10, { align: "center" });

      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.5);
      doc.setTextColor(...COLORS.muted);
      doc.text(s.label.toUpperCase(), mx + modW / 2, y + 15, {
        align: "center",
      });
    });

    y += 24;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FOOTER (on every page)
  // ═══════════════════════════════════════════════════════════════════════════

  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    const footerY = pageH - 12;
    doc.setDrawColor(...COLORS.light);
    doc.setLineWidth(0.3);
    doc.line(margin, footerY - 3, pageW - margin, footerY - 3);

    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...COLORS.muted);
    doc.text(
      "AI Observatory -- Automated Daily Intelligence Report",
      margin,
      footerY,
    );
    doc.text(`Page ${p} of ${totalPages}`, pageW - margin, footerY, {
      align: "right",
    });
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  doc.save(`observatory-report-${report.report_date}.pdf`);
}
