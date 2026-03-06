import { useState, useCallback, useEffect } from "react";
import { AppLayout } from "@/components/AppLayout";
import { useSources } from "@/hooks/use-api";
import { createSource, updateSource, fetchSourceNews, runScoutSource } from "@/lib/api";
import { timeAgo } from "@/lib/time";
import {
  Wifi, WifiOff, Plus, Loader2, Pencil, Database, Info, Eye, EyeOff,
  Sparkles, Zap, Code2, Play, Clock, ExternalLink, ChevronRight,
  CheckCircle2, AlertCircle, FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import type { Source } from "@/types";

// ── Constants ────────────────────────────────────────────

const SOURCE_OPTIONS = [
  { value: "ArXiv", label: "ArXiv" },
  { value: "Hugging Face", label: "Hugging Face" },
  { value: "Web Search", label: "Web Search" },
  { value: "n8n Workflow", label: "n8n Workflow" },
  { value: "Custom API", label: "Custom API" },
];

const N8N_HTTP_METHODS = [
  { value: "GET", label: "GET" },
  { value: "POST", label: "POST" },
];

const SCHEDULES = [
  { value: "every_30_sec", label: "Every 30 sec (testing)" },
  { value: "every_1_min", label: "Every 1 min" },
  { value: "every_5_min", label: "Every 5 min" },
  { value: "every_15_min", label: "Every 15 min" },
  { value: "every_30_min", label: "Every 30 min" },
  { value: "every_hour", label: "Hourly" },
  { value: "every_6_hours", label: "Every 6 hours" },
  { value: "daily", label: "Daily" },
];

const SCHEDULE_SECONDS: Record<string, number> = {
  every_30_sec: 30,
  every_1_min: 60,
  every_5_min: 300,
  every_15_min: 900,
  every_30_min: 1800,
  every_hour: 3600,
  every_6_hours: 21600,
  daily: 86400,
};

const ARXIV_CATEGORIES = [
  "cs.AI", "cs.LG", "cs.CL", "cs.CV", "cs.NE",
  "cs.RO", "stat.ML", "cs.MA", "cs.IR", "cs.SE",
];

const HF_MODES = [
  { value: "model", label: "Models", desc: "Search models by topic" },
  { value: "dataset", label: "Datasets", desc: "Search datasets by topic" },
  { value: "benchmark", label: "Benchmark Leaderboard", desc: "Top models ranked by likes/downloads with table" },
  { value: "daily_paper", label: "Daily Papers", desc: "Latest research papers from HuggingFace" },
  { value: "space", label: "Spaces", desc: "Top/trending HuggingFace Spaces" },
];

const HF_SORT_OPTIONS = [
  { value: "likes", label: "Likes" },
  { value: "downloads", label: "Downloads" },
  { value: "lastModified", label: "Last Modified" },
];

const HF_PIPELINE_OPTIONS = [
  { value: "all", label: "All pipelines" },
  { value: "text-generation", label: "Text Generation" },
  { value: "text-to-image", label: "Text to Image" },
  { value: "image-classification", label: "Image Classification" },
  { value: "text-classification", label: "Text Classification" },
  { value: "automatic-speech-recognition", label: "Speech Recognition" },
  { value: "translation", label: "Translation" },
  { value: "question-answering", label: "Question Answering" },
  { value: "summarization", label: "Summarization" },
];

type ModelProvider = "openai" | "anthropic";

interface ModelOption {
  id: string;
  name: string;
  badge: string;
  badgeColor: string;
  desc: string;
  icon: React.ElementType;
}

const ANTHROPIC_MODELS: ModelOption[] = [
  { id: "claude-opus-4-20250514", name: "Claude Opus 4.6", badge: "Best All-Rounder", badgeColor: "bg-orange-500/20 text-orange-400", desc: "Flagship for complex reasoning and 1M+ token context", icon: Sparkles },
  { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4.6", badge: "Best Value", badgeColor: "bg-primary/20 text-primary", desc: "Default workhorse: near-Opus quality, excels at coding", icon: Code2 },
  { id: "claude-haiku-4-20250514", name: "Claude Haiku 4.5", badge: "Speed / Low Cost", badgeColor: "bg-emerald-500/20 text-emerald-400", desc: "Extremely fast and cheap for high-volume tasks", icon: Zap },
];

const OPENAI_MODELS: ModelOption[] = [
  { id: "gpt-5.4", name: "GPT-5.4", badge: "Most Capable", badgeColor: "bg-primary/20 text-primary", desc: "Flagship model for complex, professional tasks", icon: Sparkles },
  { id: "gpt-5.4-pro", name: "GPT-5.4 Pro", badge: "High Precision", badgeColor: "bg-violet-500/20 text-violet-400", desc: "Optimized for smarter, more precise responses", icon: Code2 },
  { id: "gpt-5.4-thinking", name: "GPT-5.4 Thinking", badge: "Reasoning", badgeColor: "bg-amber-500/20 text-amber-400", desc: "Chain-of-thought, coding, and agentic tasks", icon: Zap },
  { id: "gpt-5-mini", name: "GPT-5 Mini", badge: "Speed / Cost", badgeColor: "bg-emerald-500/20 text-emerald-400", desc: "Fast, efficient, cost-effective for simple tasks", icon: Zap },
  { id: "gpt-5.3-codex", name: "GPT-5.3 Codex", badge: "Coding", badgeColor: "bg-cyan-500/20 text-cyan-400", desc: "Multi-language engineering and terminal tasks", icon: Code2 },
  { id: "gpt-4.1", name: "GPT-4.1", badge: "Balanced", badgeColor: "bg-zinc-500/20 text-zinc-400", desc: "Non-reasoning balance between speed and capability", icon: Sparkles },
];

// ── Helpers ──────────────────────────────────────────────

function sourceOptionToType(sourceOption: string): string {
  if (sourceOption === "ArXiv") return "arxiv";
  if (sourceOption === "Hugging Face") return "huggingface";
  if (sourceOption === "Web Search") return "web_search";
  if (sourceOption === "n8n Workflow") return "n8n";
  return "custom_api";
}

function friendlyType(type: string): string {
  if (type === "web_search") return "Web Search";
  if (type === "arxiv") return "ArXiv";
  if (type === "huggingface") return "Hugging Face";
  if (type === "n8n") return "n8n Workflow";
  if (type === "custom_api") return "Custom API";
  return type;
}

function friendlySchedule(schedule: string): string {
  const entry = SCHEDULES.find((s) => s.value === schedule);
  return entry ? entry.label : schedule.replace(/_/g, " ");
}

function getNextRunTime(source: Source): string | null {
  if (source.status !== "active" || !source.last_run_at || !source.schedule) return null;
  const intervalSec = SCHEDULE_SECONDS[source.schedule];
  if (!intervalSec) return null;
  const lastRun = new Date(source.last_run_at).getTime();
  const nextRun = lastRun + intervalSec * 1000;
  const now = Date.now();
  if (nextRun <= now) return "due now";
  const diffSec = Math.floor((nextRun - now) / 1000);
  const h = Math.floor(diffSec / 3600);
  const m = Math.floor((diffSec % 3600) / 60);
  const s = diffSec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

// ── Component ────────────────────────────────────────────

const SourcesPage = () => {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: sourceList = [], isLoading, error } = useSources();

  // Form state
  const [formOpen, setFormOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<Source | null>(null);
  const [saving, setSaving] = useState(false);

  const [sourceType, setSourceType] = useState("ArXiv");
  const [label, setLabel] = useState("");
  const [topic, setTopic] = useState("");
  const [itemsPerDay, setItemsPerDay] = useState("5");
  const [schedule, setSchedule] = useState("daily");
  const [categories, setCategories] = useState<string[]>(["cs.AI"]);
  const [modelProvider, setModelProvider] = useState<ModelProvider>("anthropic");
  const [modelId, setModelId] = useState("claude-sonnet-4-20250514");
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [status, setStatus] = useState<"active" | "paused">("active");
  // Tavily-specific
  const [tavilyApiKey, setTavilyApiKey] = useState("");
  const [showTavilyKey, setShowTavilyKey] = useState(false);
  const [searchDepth, setSearchDepth] = useState<"basic" | "advanced">("advanced");
  const [searchFocus, setSearchFocus] = useState<"news" | "general">("news");
  // HuggingFace-specific
  const [hfMode, setHfMode] = useState("model");
  const [hfToken, setHfToken] = useState("");
  const [showHfToken, setShowHfToken] = useState(false);
  const [hfSortBy, setHfSortBy] = useState("likes");
  const [hfPipeline, setHfPipeline] = useState("text-generation");
  // n8n-specific
  const [n8nHost, setN8nHost] = useState("https://n8n-poc.centific.com");
  const [n8nApiKey, setN8nApiKey] = useState("");
  const [showN8nKey, setShowN8nKey] = useState(false);
  const [n8nApiUrl, setN8nApiUrl] = useState("");
  const [n8nHttpMethod, setN8nHttpMethod] = useState("GET");
  const [n8nQueryParam, setN8nQueryParam] = useState("");

  // Detail / Log view state
  const [detailSource, setDetailSource] = useState<Source | null>(null);
  const [detailNews, setDetailNews] = useState<any[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<any>(null);

  // Timer for live countdown — ticks every second
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const resetForm = useCallback(() => {
    setSourceType("ArXiv");
    setLabel("");
    setTopic("");
    setItemsPerDay("5");
    setSchedule("daily");
    setCategories(["cs.AI"]);
    setModelProvider("anthropic");
    setModelId("claude-sonnet-4-20250514");
    setApiKey("");
    setShowApiKey(false);
    setStatus("active");
    setTavilyApiKey("");
    setShowTavilyKey(false);
    setSearchDepth("advanced");
    setSearchFocus("news");
    setHfMode("model");
    setHfToken("");
    setShowHfToken(false);
    setHfSortBy("likes");
    setHfPipeline("text-generation");
    setN8nHost("https://n8n-poc.centific.com");
    setN8nApiKey("");
    setShowN8nKey(false);
    setN8nApiUrl("");
    setN8nHttpMethod("GET");
    setN8nQueryParam("");
  }, []);

  const openAdd = () => {
    setEditingSource(null);
    resetForm();
    setFormOpen(true);
  };

  const openEdit = (source: Source) => {
    setEditingSource(source);
    const cfg = (source.config || {}) as Record<string, unknown>;

    const t = source.type;
    if (t === "arxiv") setSourceType("ArXiv");
    else if (t === "huggingface") setSourceType("Hugging Face");
    else if (t === "web_search") setSourceType("Web Search");
    else if (t === "n8n") setSourceType("n8n Workflow");
    else setSourceType("Custom API");

    setLabel(source.label);
    setTopic((cfg.topic as string) || "");
    setItemsPerDay(String((cfg.items_per_day as number) || 5));
    setSchedule(source.schedule || "daily");
    setCategories((cfg.categories as string[]) || []);
    setModelProvider((cfg.model_provider as ModelProvider) || "anthropic");
    setModelId((cfg.model as string) || "claude-sonnet-4-20250514");
    setApiKey("");
    setShowApiKey(false);
    setTavilyApiKey("");
    setShowTavilyKey(false);
    setSearchDepth((cfg.search_depth as "basic" | "advanced") || "advanced");
    setSearchFocus((cfg.search_focus as "news" | "general") || "news");
    setHfMode((cfg.hf_type as string) || "model");
    setHfToken(""); // don't prefill token for security
    setShowHfToken(false);
    setHfSortBy((cfg.sort_by as string) || "likes");
    setHfPipeline((cfg.pipeline_filter as string) || "text-generation");
    setN8nHost((cfg.n8n_host as string) || "https://n8n-poc.centific.com");
    setN8nApiKey(""); // don't prefill for security
    setShowN8nKey(false);
    setN8nApiUrl((cfg.api_url as string) || "");
    setN8nHttpMethod((cfg.http_method as string) || "GET");
    setN8nQueryParam((cfg.query_param as string) || "");
    setStatus(source.status);
    setFormOpen(true);
  };

  const openDetail = async (source: Source) => {
    setDetailSource(source);
    setDetailNews([]);
    setRunResult(null);
    setDetailLoading(true);
    try {
      const res = await fetchSourceNews(source.id, 30);
      setDetailNews(res.data || []);
    } catch {
      // ignore
    } finally {
      setDetailLoading(false);
    }
  };

  const handleRunNow = async () => {
    if (!detailSource || running) return;
    setRunning(true);
    setRunResult(null);
    try {
      const result = await runScoutSource(detailSource.id);
      setRunResult(result);
      toast({ title: "Scout run complete", description: `${result.ingested ?? 0} new items ingested` });
      const res = await fetchSourceNews(detailSource.id, 30);
      setDetailNews(res.data || []);
      qc.invalidateQueries({ queryKey: ["sources"] });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Scout run failed";
      setRunResult({ status: "error", error: message });
      toast({ title: "Scout run failed", description: message, variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  const toggleCategory = (cat: string) => {
    setCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat],
    );
  };

  const handleSubmit = async () => {
    if (!label.trim()) return;
    setSaving(true);

    const config: Record<string, unknown> = {
      topic: topic || undefined,
      items_per_day: Number(itemsPerDay) || 5,
      categories: categories.length > 0 ? categories : undefined,
      model_provider: modelProvider,
      model: modelId,
    };
    if (apiKey.trim()) config.api_key = apiKey.trim();
    if (sourceType === "Web Search") {
      config.search_depth = searchDepth;
      config.search_focus = searchFocus;
      if (tavilyApiKey.trim()) config.tavily_api_key = tavilyApiKey.trim();
    }
    if (sourceType === "Hugging Face") {
      config.hf_type = hfMode;
      if (hfToken.trim()) config.hf_token = hfToken.trim();
      if (hfMode === "benchmark") {
        config.sort_by = hfSortBy;
        config.pipeline_filter = hfPipeline === "all" ? "" : hfPipeline;
      }
    }
    if (sourceType === "n8n Workflow") {
      config.n8n_host = n8nHost.trim();
      if (n8nApiKey.trim()) config.n8n_api_key = n8nApiKey.trim();
      if (n8nApiUrl.trim()) config.api_url = n8nApiUrl.trim();
      if (n8nHttpMethod !== "GET") config.http_method = n8nHttpMethod;
      if (n8nQueryParam.trim()) config.query_param = n8nQueryParam.trim();
    }

    const type = sourceOptionToType(sourceType);

    try {
      if (editingSource) {
        await updateSource(editingSource.id, { label, type, config, schedule, status });
        toast({ title: "Source updated.", description: `${label} has been saved.` });
      } else {
        await createSource({ label, type, config, schedule, status });
        toast({ title: "Source created.", description: `${label} is ready to scout.` });
      }
      qc.invalidateQueries({ queryKey: ["sources"] });
      setFormOpen(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to save";
      toast({ title: "Error", description: message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const models = modelProvider === "anthropic" ? ANTHROPIC_MODELS : OPENAI_MODELS;

  return (
    <AppLayout>
      {/* Header */}
      <div className="sticky top-0 z-30 bg-background/80 backdrop-blur-xl border-b border-border px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Database size={20} className="text-primary" />
              <h1 className="text-xl font-bold text-foreground">Scout Sources</h1>
            </div>
            <p className="text-[13px] text-muted-foreground mt-0.5">Configure sources, topics, and AI models</p>
          </div>
          <Button onClick={openAdd} size="sm" className="rounded-full gap-1.5 font-bold">
            <Plus size={16} /> New Scout
          </Button>
        </div>
      </div>

      {/* Source List */}
      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 size={24} className="animate-spin text-primary" />
        </div>
      ) : error ? (
        <div className="text-center py-20 px-4">
          <p className="text-destructive text-[15px]">Failed to load sources.</p>
          <p className="text-muted-foreground text-[13px] mt-1">{(error as Error).message}</p>
        </div>
      ) : sourceList.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center px-4">
          <div className="h-16 w-16 rounded-full bg-secondary flex items-center justify-center mb-4">
            <Database size={32} className="text-muted-foreground" />
          </div>
          <h2 className="font-bold text-xl text-foreground mb-1">No sources</h2>
          <p className="text-[15px] text-muted-foreground mb-4 max-w-sm">Add a data source for scouts to crawl.</p>
          <Button onClick={openAdd} className="rounded-full gap-2 font-bold">
            <Plus size={16} /> New Scout
          </Button>
        </div>
      ) : (
        <div>
          {sourceList.map((source) => {
            const cfg = (source.config || {}) as Record<string, unknown>;
            const topicStr = cfg.topic as string | undefined;
            const nextRun = getNextRunTime(source);
            return (
              <div
                key={source.id}
                className="post-card cursor-pointer hover:bg-secondary/30 transition-colors"
                onClick={() => openDetail(source)}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`p-2 rounded-full ${
                      source.status === "active"
                        ? "bg-upvote/10 text-upvote"
                        : "bg-secondary text-muted-foreground"
                    }`}
                  >
                    {source.status === "active" ? <Wifi size={18} /> : <WifiOff size={18} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-[15px] text-foreground">{source.label}</span>
                      <span className="source-badge source-badge-default">{friendlyType(source.type)}</span>
                      {source.type === "huggingface" && cfg.hf_type && (
                        <span className="source-badge source-badge-default">{String(cfg.hf_type)}</span>
                      )}
                      {source.type === "n8n" && cfg.api_url && (
                        <span className="source-badge source-badge-default" title={String(cfg.api_url)}>
                          {String(cfg.api_url).replace(/^https?:\/\//, '').split('/')[0]}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-[13px] text-muted-foreground flex-wrap">
                      <span className={source.status === "active" ? "text-upvote" : ""}>
                        {source.status === "active" ? "Scout active" : "Paused"}
                      </span>
                      <span>·</span>
                      <span>Last run {timeAgo(source.last_run_at)}</span>
                      {source.schedule && (
                        <>
                          <span>·</span>
                          <span>{friendlySchedule(source.schedule)}</span>
                        </>
                      )}
                      {nextRun && (
                        <>
                          <span>·</span>
                          <span className="text-primary flex items-center gap-1">
                            <Clock size={11} /> Next {nextRun}
                          </span>
                        </>
                      )}
                    </div>
                    {topicStr && (
                      <p className="text-[12px] text-muted-foreground mt-0.5">Topic: {topicStr}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); openEdit(source); }}
                      className="p-2 rounded-full text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                      title="Edit"
                    >
                      <Pencil size={16} />
                    </button>
                    <ChevronRight size={16} className="text-muted-foreground/50" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Source Detail / Logs Dialog ── */}
      <Dialog open={!!detailSource} onOpenChange={(open) => { if (!open) setDetailSource(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {detailSource && (
            <>
              <DialogHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <DialogTitle className="text-lg flex items-center gap-2">
                      {detailSource.label}
                      <span className="source-badge source-badge-default text-[12px]">
                        {friendlyType(detailSource.type)}
                      </span>
                    </DialogTitle>
                    <div className="flex items-center gap-2 mt-1 text-[13px] text-muted-foreground">
                      <span className={detailSource.status === "active" ? "text-upvote" : ""}>
                        {detailSource.status === "active" ? "Active" : "Paused"}
                      </span>
                      <span>·</span>
                      <span>{friendlySchedule(detailSource.schedule || "daily")}</span>
                      <span>·</span>
                      <span>Last run {timeAgo(detailSource.last_run_at)}</span>
                      {(() => {
                        const nr = getNextRunTime(detailSource);
                        return nr ? (
                          <>
                            <span>·</span>
                            <span className="text-primary">Next {nr}</span>
                          </>
                        ) : null;
                      })()}
                    </div>
                  </div>
                </div>
              </DialogHeader>

              {/* Action buttons */}
              <div className="flex gap-2 mt-2">
                <Button
                  size="sm"
                  className="gap-1.5 rounded-full font-bold"
                  onClick={handleRunNow}
                  disabled={running}
                >
                  {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                  {running ? "Running..." : "Run Now"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 rounded-full"
                  onClick={() => { setDetailSource(null); openEdit(detailSource); }}
                >
                  <Pencil size={14} /> Edit
                </Button>
              </div>

              {/* Run result */}
              {runResult && (
                <div className={`mt-3 p-3 rounded-lg border text-[13px] ${
                  runResult.status === "error"
                    ? "border-destructive/50 bg-destructive/5 text-destructive"
                    : "border-upvote/50 bg-upvote/5 text-upvote"
                }`}>
                  {runResult.status === "error" ? (
                    <div className="flex items-center gap-2">
                      <AlertCircle size={16} />
                      <span>Error: {runResult.error}</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <CheckCircle2 size={16} />
                      <span>
                        Fetched {runResult.fetched ?? 0} items
                        {runResult.new != null && ` · ${runResult.new} new`}
                        {" · "}{runResult.ingested ?? 0} ingested
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* News items / logs */}
              <div className="mt-4">
                <div className="flex items-center gap-2 mb-3">
                  <FileText size={16} className="text-muted-foreground" />
                  <h3 className="font-bold text-[14px] text-foreground">
                    Fetched Items ({detailLoading ? "..." : detailNews.length})
                  </h3>
                </div>

                {detailLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 size={20} className="animate-spin text-primary" />
                  </div>
                ) : detailNews.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-[13px]">
                    No items fetched yet. Click "Run Now" to fetch.
                  </div>
                ) : (
                  <div className="space-y-1">
                    {detailNews.map((item: any) => (
                      <div
                        key={item.id}
                        className="p-3 rounded-lg border border-border hover:border-foreground/20 transition-colors"
                      >
                        <div className="flex items-start gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-[13px] text-foreground leading-snug">
                              {item.title}
                            </p>
                            <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground">
                              <span>{item.source_label}</span>
                              <span>·</span>
                              <span>{timeAgo(item.ingested_at || item.published_at)}</span>
                            </div>
                            {item.summary && (
                              <p className="text-[12px] text-muted-foreground mt-1 line-clamp-2">
                                {item.summary}
                              </p>
                            )}
                          </div>
                          {item.url && (
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="shrink-0 p-1.5 rounded-full text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                              onClick={(e) => e.stopPropagation()}
                              title="Open article"
                            >
                              <ExternalLink size={14} />
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── New / Edit Scout Source Dialog ── */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg">
              {editingSource ? `Edit ${editingSource.label}` : "New Scout Source"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5 py-1">
            {/* Source type */}
            <div className="space-y-1.5">
              <Label className="font-semibold">Source</Label>
              <Select value={sourceType} onValueChange={setSourceType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SOURCE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Label */}
            <div className="space-y-1.5">
              <Label className="font-semibold">Label</Label>
              <Input
                placeholder="e.g. ArXiv - Transformers"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>

            {/* Topic + Items/day */}
            <div className="flex gap-3">
              <div className="flex-1 space-y-1.5">
                <Label className="font-semibold">Topic</Label>
                <Input
                  placeholder="e.g. transformer architecture"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                />
              </div>
              <div className="w-24 space-y-1.5">
                <Label className="font-semibold">Items/day</Label>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={itemsPerDay}
                  onChange={(e) => setItemsPerDay(e.target.value)}
                />
              </div>
            </div>

            {/* Schedule */}
            <div className="space-y-1.5">
              <Label className="font-semibold">Schedule</Label>
              <Select value={schedule} onValueChange={setSchedule}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SCHEDULES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Categories (for ArXiv) */}
            {(sourceType === "ArXiv" || sourceType === "Hugging Face") && (
              <div className="space-y-2">
                <Label className="font-semibold">Categories (optional)</Label>
                <div className="flex flex-wrap gap-1.5">
                  {ARXIV_CATEGORIES.map((cat) => {
                    const active = categories.includes(cat);
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => toggleCategory(cat)}
                        className={`text-[13px] px-3 py-1.5 rounded-full border transition-colors ${
                          active
                            ? "bg-primary text-primary-foreground border-primary"
                            : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
                        }`}
                      >
                        {cat}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Web Search (Tavily) options */}
            {sourceType === "Web Search" && (
              <div className="space-y-4 p-3.5 rounded-xl border border-border bg-secondary/30">
                <div className="text-[12px] text-muted-foreground uppercase tracking-wider font-bold">
                  Tavily Web Search Settings
                </div>

                <div className="space-y-1.5">
                  <Label className="font-semibold">Tavily API Key</Label>
                  <div className="relative">
                    <Input
                      type={showTavilyKey ? "text" : "password"}
                      placeholder="tvly-..."
                      value={tavilyApiKey}
                      onChange={(e) => setTavilyApiKey(e.target.value)}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowTavilyKey(!showTavilyKey)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      tabIndex={-1}
                    >
                      {showTavilyKey ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Leave blank to use the server default (TAVILY_API_KEY env).
                  </p>
                </div>

                <div className="flex gap-3">
                  <div className="flex-1 space-y-1.5">
                    <Label className="font-semibold">Search Depth</Label>
                    <Select value={searchDepth} onValueChange={(v: "basic" | "advanced") => setSearchDepth(v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="basic">Basic</SelectItem>
                        <SelectItem value="advanced">Advanced</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex-1 space-y-1.5">
                    <Label className="font-semibold">Search Focus</Label>
                    <Select value={searchFocus} onValueChange={(v: "news" | "general") => setSearchFocus(v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="news">News</SelectItem>
                        <SelectItem value="general">General</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            )}

            {/* HuggingFace options */}
            {sourceType === "Hugging Face" && (
              <div className="space-y-4 p-3.5 rounded-xl border border-border bg-secondary/30">
                <div className="text-[12px] text-muted-foreground uppercase tracking-wider font-bold">
                  HuggingFace Settings
                </div>

                <div className="space-y-1.5">
                  <Label className="font-semibold">Mode</Label>
                  <div className="space-y-1.5">
                    {HF_MODES.map((mode) => (
                      <button
                        key={mode.value}
                        type="button"
                        onClick={() => setHfMode(mode.value)}
                        className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-all ${
                          hfMode === mode.value
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-foreground/20"
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <span className="font-bold text-[13px] text-foreground">{mode.label}</span>
                          <p className="text-[11px] text-muted-foreground mt-0.5">{mode.desc}</p>
                        </div>
                        <div className="shrink-0">
                          <div className={`h-4 w-4 rounded-full border-2 flex items-center justify-center ${
                            hfMode === mode.value ? "border-primary" : "border-muted-foreground/40"
                          }`}>
                            {hfMode === mode.value && <div className="h-2 w-2 rounded-full bg-primary" />}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {hfMode === "benchmark" && (
                  <div className="flex gap-3">
                    <div className="flex-1 space-y-1.5">
                      <Label className="font-semibold">Sort by</Label>
                      <Select value={hfSortBy} onValueChange={setHfSortBy}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {HF_SORT_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex-1 space-y-1.5">
                      <Label className="font-semibold">Pipeline</Label>
                      <Select value={hfPipeline} onValueChange={setHfPipeline}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {HF_PIPELINE_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label className="font-semibold">HuggingFace API Token</Label>
                  <div className="relative">
                    <Input
                      type={showHfToken ? "text" : "password"}
                      placeholder="hf_..."
                      value={hfToken}
                      onChange={(e) => setHfToken(e.target.value)}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowHfToken(!showHfToken)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      tabIndex={-1}
                    >
                      {showHfToken ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Optional. Provides higher rate limits and access to gated models.
                  </p>
                </div>
              </div>
            )}

            {/* n8n Workflow options */}
            {sourceType === "n8n Workflow" && (
              <div className="space-y-4 p-3.5 rounded-xl border border-border bg-secondary/30">
                <div className="text-[12px] text-muted-foreground uppercase tracking-wider font-bold">
                  n8n Workflow Settings
                </div>

                <div className="space-y-1.5">
                  <Label className="font-semibold">API URL</Label>
                  <Input
                    placeholder="https://api.example.com/v1/items"
                    value={n8nApiUrl}
                    onChange={(e) => setN8nApiUrl(e.target.value)}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Any REST API endpoint. The AI will probe it, analyze the response, and auto-create an n8n workflow.
                  </p>
                </div>

                <div className="flex gap-3">
                  <div className="w-28 space-y-1.5">
                    <Label className="font-semibold">Method</Label>
                    <Select value={n8nHttpMethod} onValueChange={setN8nHttpMethod}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {N8N_HTTP_METHODS.map((m) => (
                          <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex-1 space-y-1.5">
                    <Label className="font-semibold">Query Param for Topic</Label>
                    <Input
                      placeholder="e.g. q, search, query (optional)"
                      value={n8nQueryParam}
                      onChange={(e) => setN8nQueryParam(e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="font-semibold">n8n Instance URL</Label>
                  <Input
                    placeholder="https://n8n-poc.centific.com"
                    value={n8nHost}
                    onChange={(e) => setN8nHost(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="font-semibold">n8n API Key</Label>
                  <div className="relative">
                    <Input
                      type={showN8nKey ? "text" : "password"}
                      placeholder="eyJhbG..."
                      value={n8nApiKey}
                      onChange={(e) => setN8nApiKey(e.target.value)}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowN8nKey(!showN8nKey)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      tabIndex={-1}
                    >
                      {showN8nKey ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <div className="p-2.5 rounded-lg bg-primary/5 border border-primary/20">
                  <p className="text-[11px] text-primary leading-relaxed">
                    The AI will probe your API, analyze its response structure, auto-generate a tailored n8n workflow,
                    create it in your n8n instance, activate it, and trigger it to fetch data.
                  </p>
                </div>
              </div>
            )}

            {/* Status (edit only) */}
            {editingSource && (
              <div className="space-y-1.5">
                <Label className="font-semibold">Status</Label>
                <Select value={status} onValueChange={(v: "active" | "paused") => setStatus(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="paused">Paused</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* AI Model Section */}
            <div className="space-y-3">
              <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground uppercase tracking-wider font-bold">
                <Info size={14} />
                AI Model for Summarization
              </div>

              <div className="flex rounded-full border border-border overflow-hidden">
                <button
                  type="button"
                  onClick={() => { setModelProvider("openai"); setModelId("gpt-5.4"); }}
                  className={`flex-1 py-2.5 text-[14px] font-medium transition-colors ${
                    modelProvider === "openai"
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  OpenAI
                </button>
                <button
                  type="button"
                  onClick={() => { setModelProvider("anthropic"); setModelId("claude-sonnet-4-20250514"); }}
                  className={`flex-1 py-2.5 text-[14px] font-medium transition-colors ${
                    modelProvider === "anthropic"
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Anthropic Claude
                </button>
              </div>

              <div className="space-y-2">
                {models.map((m) => {
                  const selected = modelId === m.id;
                  const Icon = m.icon;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setModelId(m.id)}
                      className={`w-full flex items-center gap-3 p-3.5 rounded-xl border text-left transition-all ${
                        selected
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-foreground/20"
                      }`}
                    >
                      <div className="shrink-0 h-9 w-9 rounded-lg bg-secondary flex items-center justify-center">
                        <Icon size={18} className={selected ? "text-primary" : "text-muted-foreground"} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-[14px] text-foreground">{m.name}</span>
                          <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${m.badgeColor}`}>
                            {m.badge}
                          </span>
                        </div>
                        <p className="text-[12px] text-muted-foreground mt-0.5">{m.desc}</p>
                      </div>
                      <div className="shrink-0">
                        <div className={`h-5 w-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                          selected ? "border-primary" : "border-muted-foreground/40"
                        }`}>
                          {selected && <div className="h-2.5 w-2.5 rounded-full bg-primary" />}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* API Key */}
            <div className="space-y-1.5">
              <Label className="font-semibold">
                {modelProvider === "anthropic" ? "Anthropic API Key" : "OpenAI API Key"}
              </Label>
              <div className="relative">
                <Input
                  type={showApiKey ? "text" : "password"}
                  placeholder={modelProvider === "anthropic" ? "sk-ant-..." : "sk-proj-..."}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Leave blank to use the server default, or enter a per-source key.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={saving || !label.trim()}
              className="gap-2 rounded-full font-bold"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              {editingSource ? "Save changes" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
};

export default SourcesPage;
