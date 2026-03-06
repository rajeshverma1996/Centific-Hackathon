const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export function getToken(): string | null {
  return localStorage.getItem('observatory_token');
}

export function setTokens(token: string, refreshToken: string): void {
  localStorage.setItem('observatory_token', token);
  localStorage.setItem('observatory_refresh_token', refreshToken);
}

export function clearTokens(): void {
  localStorage.removeItem('observatory_token');
  localStorage.removeItem('observatory_refresh_token');
  localStorage.removeItem('observatory_user');
}

async function apiFetch<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (res.status === 401) {
    const refreshed = await tryRefreshToken();
    if (refreshed) {
      headers['Authorization'] = `Bearer ${getToken()}`;
      const retryRes = await fetch(`${API_BASE}${path}`, { ...options, headers });
      if (retryRes.ok) {
        return retryRes.json();
      }
    }
    clearTokens();
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `API error: ${res.status}`);
  }

  return res.json();
}

async function tryRefreshToken(): Promise<boolean> {
  const refreshToken = localStorage.getItem('observatory_refresh_token');
  if (!refreshToken) return false;

  try {
    const res = await fetch(`${API_BASE}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (!res.ok) return false;

    const data = await res.json();
    setTokens(data.token, data.refreshToken);
    return true;
  } catch {
    return false;
  }
}

// ── Auth ────────────────────────────────────────────────────────────────

export async function apiLogin(email: string, password: string) {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Login failed');
  }
  const data = await res.json();
  setTokens(data.token, data.refreshToken);
  localStorage.setItem('observatory_user', JSON.stringify(data.user));
  return data;
}

export async function apiRegister(email: string, password: string, name: string) {
  const res = await fetch(`${API_BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Registration failed');
  }
  const data = await res.json();
  setTokens(data.token, data.refreshToken);
  localStorage.setItem('observatory_user', JSON.stringify(data.user));
  return data;
}

// ── Agents ──────────────────────────────────────────────────────────────

export const fetchAgents = (params?: Record<string, string>) => {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return apiFetch<{ data: any[] }>(`/api/agents${qs}`);
};

export const fetchAgent = (id: string) =>
  apiFetch<{ data: any }>(`/api/agents/${id}`);

export const createAgent = (body: any) =>
  apiFetch<{ data: any }>('/api/agents', {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const updateAgent = (id: string, body: any) =>
  apiFetch<{ data: any }>(`/api/agents/${id}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });

export const deleteAgent = (id: string) =>
  apiFetch<{ message: string }>(`/api/agents/${id}`, { method: 'DELETE' });

// ── Posts ────────────────────────────────────────────────────────────────

export const fetchPosts = (params?: Record<string, string>) => {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return apiFetch<{ data: any[] }>(`/api/posts${qs}`);
};

export const fetchPost = (id: string) =>
  apiFetch<{ data: any }>(`/api/posts/${id}`);

export const fetchReplies = (postId: string) =>
  apiFetch<{ data: any[] }>(`/api/posts/${postId}/replies`);

export const createPost = (body: any) =>
  apiFetch<{ data: any }>('/api/posts', {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const voteOnPost = (postId: string, body: { voter_agent_id: string; vote_type: 'up' | 'down' }) =>
  apiFetch(`/api/posts/${postId}/vote`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

// ── News ────────────────────────────────────────────────────────────────

export const fetchNews = (params?: Record<string, string>) => {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return apiFetch<{ data: any[] }>(`/api/news${qs}`);
};

export const fetchNewsItem = (id: string) =>
  apiFetch<{ data: any }>(`/api/news/${id}`);

// ── Sources ─────────────────────────────────────────────────────────────

export const fetchSources = () =>
  apiFetch<{ data: any[] }>('/api/sources');

export const createSource = (body: any) =>
  apiFetch<{ data: any }>('/api/sources', {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const updateSource = (id: string, body: any) =>
  apiFetch<{ data: any }>(`/api/sources/${id}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });

export const fetchSourceNews = (id: string, limit = 50) =>
  apiFetch<{ data: any[] }>(`/api/sources/${id}/news?limit=${limit}`);

export const runScoutSource = (id: string) =>
  apiFetch<any>(`/api/sources/${id}/run`, { method: 'POST' });

// ── Agent Activity ──────────────────────────────────────────────────

export const fetchAgentActivity = (id: string, limit = 50) =>
  apiFetch<{ data: any[] }>(`/api/agents/${id}/activity?limit=${limit}`);

export const fetchAgentPosts = (id: string) =>
  apiFetch<{ data: any[] }>(`/api/agents/${id}/posts`);

// ── Reports ─────────────────────────────────────────────────────────────

export const fetchReports = (params?: Record<string, string>) => {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return apiFetch<{ data: any[] }>(`/api/reports${qs}`);
};

export const generateReport = (date?: string) =>
  apiFetch<any>('/api/reports/generate', {
    method: 'POST',
    body: JSON.stringify(date ? { date } : {}),
  });

export const fetchActivityLogs = (params?: Record<string, string>) => {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return apiFetch<{ data: any[] }>(`/api/reports/logs${qs}`);
};

// ── Moderation ──────────────────────────────────────────────────────────

export const fetchModerationReviews = (params?: Record<string, string>) => {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return apiFetch<{ data: any[] }>(`/api/moderation/reviews${qs}`);
};

export const updateModerationReview = (id: string, body: { status: string }) =>
  apiFetch<{ data: any }>(`/api/moderation/reviews/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });

export const fetchModerationStats = () =>
  apiFetch<{ data: any }>('/api/moderation/stats');

// ── Usage / Dashboard ───────────────────────────────────────────────────

export const fetchUsageStats = (params?: Record<string, string>) => {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return apiFetch<{ data: any }>(`/api/usage/stats${qs}`);
};

export const fetchUsageTimeline = (params?: Record<string, string>) => {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return apiFetch<{ data: any[] }>(`/api/usage/timeline${qs}`);
};

export const fetchUsageRecent = (params?: Record<string, string>) => {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return apiFetch<{ data: any[] }>(`/api/usage/recent${qs}`);
};