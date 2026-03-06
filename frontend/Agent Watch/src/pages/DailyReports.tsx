import { useState, useEffect, useRef } from "react";
import { AppLayout } from "@/components/AppLayout";
import { useReports, useGenerateReport, useActivityLogs } from "@/hooks/use-api";
import { timeAgo } from "@/lib/time";
import { downloadReportPdf } from "@/lib/report-pdf";
import {
  Download,
  Newspaper,
  MessageSquare,
  Activity,
  Loader2,
  Sparkles,
  Calendar,
  Clock,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Mail,
  FileText,
  ScrollText,
  X,
} from "lucide-react";

/** Format a date string into a readable date */
function formatReportDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Format a datetime string into a readable date + time */
function formatDateTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Status badge colours */
function statusStyles(status: string) {
  switch (status) {
    case "success":
      return "bg-green-500/10 text-green-400 border-green-500/20";
    case "failure":
      return "bg-red-500/10 text-red-400 border-red-500/20";
    case "skipped":
      return "bg-yellow-500/10 text-yellow-400 border-yellow-500/20";
    default:
      return "bg-muted/10 text-muted-foreground border-border";
  }
}

/** Icon for event type */
function EventIcon({ type }: { type: string }) {
  switch (type) {
    case "report_generation":
      return <FileText size={14} className="text-primary" />;
    case "email_sent":
      return <Mail size={14} className="text-green-400" />;
    case "email_failed":
      return <Mail size={14} className="text-red-400" />;
    case "email_notification":
      return <Mail size={14} className="text-yellow-400" />;
    default:
      return <Activity size={14} className="text-muted-foreground" />;
  }
}

/** Status icon */
function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "success":
      return <CheckCircle2 size={12} className="text-green-400" />;
    case "failure":
      return <XCircle size={12} className="text-red-400" />;
    case "skipped":
      return <AlertTriangle size={12} className="text-yellow-400" />;
    default:
      return null;
  }
}

/** ── Activity Logs Modal ─────────────────────────────────────────────── */
function ActivityLogsModal({
  open,
  onClose,
  logs,
  isLoading,
}: {
  open: boolean;
  onClose: () => void;
  logs: any[];
  isLoading: boolean;
}) {
  const [expandedLog, setExpandedLog] = useState<string | null>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === backdropRef.current) onClose();
      }}
    >
      <div className="relative w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col rounded-xl border border-border bg-background shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-card/50">
          <div className="flex items-center gap-2.5">
            <ScrollText size={18} className="text-primary" />
            <h2 className="text-[15px] font-bold text-foreground">
              Activity Logs
            </h2>
            <span className="text-[11px] text-muted-foreground bg-muted/40 px-2 py-0.5 rounded-full">
              {logs.length} entries
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 size={20} className="animate-spin text-primary" />
            </div>
          ) : logs.length === 0 ? (
            <p className="text-[13px] text-muted-foreground py-10 text-center">
              No activity logs yet. Logs will appear here after report generation or email events.
            </p>
          ) : (
            <div className="space-y-1.5">
              {logs.map((log: any) => (
                <div
                  key={log.id}
                  className="rounded-lg border border-border bg-card/30 overflow-hidden"
                >
                  {/* Log header row */}
                  <button
                    onClick={() =>
                      setExpandedLog(expandedLog === log.id ? null : log.id)
                    }
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-card/50 transition-colors"
                  >
                    <EventIcon type={log.event_type} />

                    <span
                      className={`inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded border ${statusStyles(
                        log.status
                      )}`}
                    >
                      <StatusIcon status={log.status} />
                      {log.status}
                    </span>

                    <span className="text-[11px] font-mono text-muted-foreground/70 bg-muted/30 px-1.5 py-0.5 rounded">
                      {log.event_type}
                    </span>

                    <span className="flex-1 text-[12px] text-muted-foreground truncate">
                      {log.summary || "\u2014"}
                    </span>

                    <span className="text-[11px] text-muted-foreground/60 shrink-0">
                      {log.created_at ? timeAgo(log.created_at) : ""}
                    </span>

                    {expandedLog === log.id ? (
                      <ChevronDown size={12} className="text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronRight size={12} className="text-muted-foreground shrink-0" />
                    )}
                  </button>

                  {/* Expanded details */}
                  {expandedLog === log.id && log.details && (
                    <div className="px-3 pb-2.5 pt-0.5 border-t border-border/50">
                      <div className="text-[11px] text-muted-foreground/60 mb-1">
                        {log.created_at && formatDateTime(log.created_at)}
                      </div>
                      <pre className="text-[11px] text-muted-foreground bg-background/50 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all max-h-48 overflow-y-auto font-mono">
                        {JSON.stringify(log.details, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** ── Main Page ────────────────────────────────────────────────────────── */
const DailyReportsPage = () => {
  const { data: reports = [], isLoading, error } = useReports({ limit: "30" });
  const { data: logs = [], isLoading: logsLoading } = useActivityLogs({ limit: "50" });
  const generateReport = useGenerateReport();
  const [genStatus, setGenStatus] = useState<string | null>(null);
  const [logsModalOpen, setLogsModalOpen] = useState(false);

  const handleGenerate = async () => {
    setGenStatus("generating");
    try {
      const result = await generateReport.mutateAsync(undefined);
      if (result.status === "ok") {
        setGenStatus("success");
      } else {
        setGenStatus(`failed: ${result.reason || "unknown error"}`);
      }
    } catch (err: any) {
      setGenStatus(`error: ${err.message}`);
    }
    setTimeout(() => setGenStatus(null), 5000);
  };

  const handleDownloadPdf = (report: any) => {
    downloadReportPdf(report);
  };

  return (
    <AppLayout>
      <div className="sticky top-0 z-30 bg-background/80 backdrop-blur-xl border-b border-border px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-foreground">Daily Reports</h1>
              {/* Activity Logs icon button */}
              <button
                onClick={() => setLogsModalOpen(true)}
                title="Activity Logs"
                className="relative p-1 rounded-md hover:bg-primary/10 text-muted-foreground hover:text-primary transition-all"
              >
                <ScrollText size={15} />
                {logs.length > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[14px] h-3.5 flex items-center justify-center text-[8px] font-bold bg-primary text-primary-foreground rounded-full px-0.5 leading-none">
                    {logs.length}
                  </span>
                )}
              </button>
            </div>
            <p className="text-[13px] text-muted-foreground mt-0.5">
              AI-generated intelligence reports from the Observatory
            </p>
          </div>
          <button
            onClick={handleGenerate}
            disabled={genStatus === "generating"}
            className="shrink-0 flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-primary text-primary-foreground text-[13px] font-semibold hover:bg-primary/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {genStatus === "generating" ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Sparkles size={14} />
            )}
            {genStatus === "generating" ? "Generating..." : "Generate Report"}
          </button>
        </div>
        {genStatus && genStatus !== "generating" && (
          <div
            className={`mt-2 text-[13px] px-3 py-1.5 rounded-lg ${
              genStatus === "success"
                ? "bg-green-500/10 text-green-400"
                : "bg-destructive/10 text-destructive"
            }`}
          >
            {genStatus === "success"
              ? "Report generated successfully!"
              : `Generation ${genStatus}`}
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 size={24} className="animate-spin text-primary" />
        </div>
      ) : error ? (
        <div className="text-center py-20 px-4">
          <p className="text-destructive text-[15px]">
            Failed to load reports. Is the backend running?
          </p>
          <p className="text-muted-foreground text-[13px] mt-1">
            {(error as Error).message}
          </p>
        </div>
      ) : reports.length === 0 ? (
        <div className="text-center py-20 px-4">
          <Newspaper size={40} className="mx-auto text-muted-foreground/30 mb-3" />
          <p className="text-muted-foreground text-[15px]">No reports generated yet.</p>
          <p className="text-muted-foreground/60 text-[13px] mt-1">
            Click "Generate Today's Report" to create the first one.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {reports.map((report: any) => (
            <div
              key={report.id}
              className="px-4 py-4 hover:bg-card/50 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  {/* Date & Time Row */}
                  <div className="flex items-center gap-3 text-[12px] text-muted-foreground mb-1.5">
                    <span className="flex items-center gap-1">
                      <Calendar size={12} className="text-primary" />
                      {formatReportDate(report.report_date)}
                    </span>
                    {report.created_at && (
                      <>
                        <span className="text-border">|</span>
                        <span className="flex items-center gap-1">
                          <Clock size={12} />
                          {formatDateTime(report.created_at)}
                        </span>
                        <span className="text-border">|</span>
                        <span className="text-muted-foreground/70">
                          {timeAgo(report.created_at)}
                        </span>
                      </>
                    )}
                  </div>

                  {/* Headline */}
                  <h3 className="font-bold text-[15px] text-foreground leading-snug">
                    {report.headline || report.report_date}
                  </h3>

                  {/* Summary */}
                  {report.summary && (
                    <p className="text-[13px] text-muted-foreground mt-1.5 leading-relaxed line-clamp-3">
                      {report.summary}
                    </p>
                  )}

                  {/* Stats Badges */}
                  <div className="flex flex-wrap gap-3 mt-2.5">
                    {report.news_count != null && (
                      <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground bg-primary/5 px-2 py-0.5 rounded-full">
                        <Newspaper size={12} className="text-primary" />
                        {report.news_count} news
                      </span>
                    )}
                    {report.post_count != null && (
                      <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground bg-pink-500/5 px-2 py-0.5 rounded-full">
                        <MessageSquare size={12} className="text-pink-400" />
                        {report.post_count} posts
                      </span>
                    )}
                    {report.agent_findings_count != null && (
                      <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground bg-green-500/5 px-2 py-0.5 rounded-full">
                        <Activity size={12} className="text-green-400" />
                        {report.agent_findings_count} total activity
                      </span>
                    )}
                  </div>
                </div>

                {/* Download PDF Button */}
                <button
                  onClick={() => handleDownloadPdf(report)}
                  title="Download as PDF"
                  className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium text-primary border border-primary/20 hover:bg-primary/10 hover:border-primary/40 transition-all"
                >
                  <Download size={14} />
                  PDF
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Activity Logs Modal */}
      <ActivityLogsModal
        open={logsModalOpen}
        onClose={() => setLogsModalOpen(false)}
        logs={logs}
        isLoading={logsLoading}
      />
    </AppLayout>
  );
};

export default DailyReportsPage;
