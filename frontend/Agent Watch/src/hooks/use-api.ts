import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchAgents, createAgent, updateAgent, deleteAgent,
  fetchAgentActivity, fetchAgentPosts,
  fetchPosts, fetchReplies,
  fetchNews,
  fetchSources, createSource, updateSource,
  fetchReports, generateReport, fetchActivityLogs,
  fetchModerationReviews, updateModerationReview, fetchModerationStats,
  fetchUsageStats, fetchUsageTimeline,
} from "@/lib/api";

// ── Agents ───────────────────────────────────────────────

export function useAgents(params?: Record<string, string>) {
  return useQuery({
    queryKey: ["agents", params],
    queryFn: () => fetchAgents(params),
    select: (res) => res.data,
  });
}

export function useCreateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: any) => createAgent(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agents"] }),
  });
}

export function useUpdateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) => updateAgent(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agents"] }),
  });
}

export function useDeleteAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteAgent(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agents"] }),
  });
}

export function useAgentActivity(agentId: string) {
  return useQuery({
    queryKey: ["agents", agentId, "activity"],
    queryFn: () => fetchAgentActivity(agentId),
    select: (res) => res.data,
    enabled: !!agentId,
  });
}

export function useAgentPosts(agentId: string) {
  return useQuery({
    queryKey: ["agents", agentId, "posts"],
    queryFn: () => fetchAgentPosts(agentId),
    select: (res) => res.data,
    enabled: !!agentId,
  });
}

// ── Posts ─────────────────────────────────────────────────

export function usePosts(params?: Record<string, string>) {
  return useQuery({
    queryKey: ["posts", params],
    queryFn: () => fetchPosts(params),
    select: (res) => res.data,
  });
}

export function usePostReplies(postId: string) {
  return useQuery({
    queryKey: ["posts", postId, "replies"],
    queryFn: () => fetchReplies(postId),
    select: (res) => res.data,
    enabled: !!postId,
  });
}

// ── News ─────────────────────────────────────────────────

export function useNews(params?: Record<string, string>) {
  return useQuery({
    queryKey: ["news", params],
    queryFn: () => fetchNews(params),
    select: (res) => res.data,
  });
}

// ── Sources ──────────────────────────────────────────────

export function useSources() {
  return useQuery({
    queryKey: ["sources"],
    queryFn: () => fetchSources(),
    select: (res) => res.data,
  });
}

export function useCreateSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: any) => createSource(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sources"] }),
  });
}

export function useUpdateSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) => updateSource(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sources"] }),
  });
}

// ── Reports ──────────────────────────────────────────────

export function useReports(params?: Record<string, string>) {
  return useQuery({
    queryKey: ["reports", params],
    queryFn: () => fetchReports(params),
    select: (res) => res.data,
  });
}

export function useGenerateReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (date?: string) => generateReport(date),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reports"] });
      qc.invalidateQueries({ queryKey: ["activity-logs"] });
    },
  });
}

export function useActivityLogs(params?: Record<string, string>) {
  return useQuery({
    queryKey: ["activity-logs", params],
    queryFn: () => fetchActivityLogs(params),
    select: (res) => res.data,
    refetchInterval: 30_000, // auto-refresh every 30s
  });
}

// ── Moderation ───────────────────────────────────────────

export function useModerationReviews(params?: Record<string, string>) {
  return useQuery({
    queryKey: ["moderation", "reviews", params],
    queryFn: () => fetchModerationReviews(params),
    select: (res) => res.data,
  });
}

export function useModerationStats() {
  return useQuery({
    queryKey: ["moderation", "stats"],
    queryFn: () => fetchModerationStats(),
    select: (res) => res.data,
  });
}

export function useUpdateReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      updateModerationReview(id, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["moderation"] });
    },
  });
}

// ── Usage / Dashboard ────────────────────────────────────

export function useUsageStats(params?: Record<string, string>) {
  return useQuery({
    queryKey: ["usage", "stats", params],
    queryFn: () => fetchUsageStats(params),
    select: (res) => res.data,
  });
}

export function useUsageTimeline(params?: Record<string, string>) {
  return useQuery({
    queryKey: ["usage", "timeline", params],
    queryFn: () => fetchUsageTimeline(params),
    select: (res) => res.data,
  });
}