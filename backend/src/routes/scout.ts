import { Router, Request, Response } from 'express';
import { scoutAuth } from '../middleware/auth';
import { supabase } from '../config/supabase';

const router = Router();

const SCOUT_TYPES = ['arxiv', 'huggingface', 'custom_api', 'web_search'];

/**
 * GET /api/scout/sources
 * Returns only active scout sources (arxiv, huggingface, custom_api).
 */
router.get('/sources', scoutAuth, async (_req: Request, res: Response): Promise<void> => {
  try {
    const { data, error } = await supabase
      .from('sources')
      .select('id, label, type, status, config, schedule, n8n_workflow_id, last_run_at')
      .in('type', SCOUT_TYPES)
      .eq('status', 'active')
      .eq('active_flag', 'Y')
      .order('label', { ascending: true });

    if (error) {
      res.status(500).json({ error: 'Failed to fetch scout sources', detail: error.message });
      return;
    }

    res.json({ data: data || [] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/scout/ingest
 * Bulk-ingest news items from a scout run.
 * Inserts each item individually, skipping duplicates by URL.
 */
router.post('/ingest', scoutAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'items array is required and must not be empty' });
      return;
    }

    const rows = items.map((item: any) => ({
      title: item.title,
      source_label: item.source_label,
      source_id: item.source_id || null,
      type: item.type || 'update',
      summary: item.summary || null,
      url: item.url || null,
      raw_content: item.raw_content || null,
      metadata: item.metadata || {},
      published_at: item.published_at || new Date().toISOString(),
    }));

    for (const row of rows) {
      if (!row.title || !row.source_label) {
        res.status(400).json({ error: 'Each item must have title and source_label' });
        return;
      }
    }

    let inserted = 0;
    let skipped = 0;
    const insertedItems: any[] = [];

    for (const row of rows) {
      if (row.url) {
        // Check if an active item with this URL already exists
        const { data: activeExisting } = await supabase
          .from('news_items')
          .select('id')
          .eq('url', row.url)
          .eq('active_flag', 'Y')
          .maybeSingle();

        if (activeExisting) {
          skipped++;
          continue;
        }

        // Check if a soft-deleted item with this URL exists — reactivate it
        const { data: inactiveExisting } = await supabase
          .from('news_items')
          .select('id')
          .eq('url', row.url)
          .neq('active_flag', 'Y')
          .maybeSingle();

        if (inactiveExisting) {
          const { data: reactivated, error: reactivateErr } = await supabase
            .from('news_items')
            .update({
              ...row,
              active_flag: 'Y',
            })
            .eq('id', inactiveExisting.id)
            .select('id, title, url')
            .single();

          if (!reactivateErr && reactivated) {
            inserted++;
            insertedItems.push(reactivated);
          } else {
            console.error(`[scout/ingest] Failed to reactivate "${row.title}": ${reactivateErr?.message}`);
          }
          continue;
        }
      }

      const { data, error } = await supabase
        .from('news_items')
        .insert(row)
        .select('id, title, url')
        .single();

      if (error) {
        if (error.code === '23505') {
          skipped++;
          continue;
        }
        console.error(`[scout/ingest] Failed to insert "${row.title}": ${error.message}`);
        continue;
      }

      inserted++;
      insertedItems.push(data);
    }

    console.log(`[scout/ingest] Result: ${inserted} inserted, ${skipped} skipped (duplicate)`);

    res.status(201).json({
      ingested: inserted,
      skipped,
      total: rows.length,
      data: insertedItems,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/scout/check-urls
 * Check which URLs already exist in news_items.
 * Body: { urls: string[] }
 * Returns: { existing: string[] }
 */
router.post('/check-urls', scoutAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { urls } = req.body;

    if (!Array.isArray(urls) || urls.length === 0) {
      res.json({ existing: [] });
      return;
    }

    const { data, error } = await supabase
      .from('news_items')
      .select('url')
      .in('url', urls)
      .eq('active_flag', 'Y');

    if (error) {
      res.status(500).json({ error: 'Failed to check URLs', detail: error.message });
      return;
    }

    const existing = (data || []).map((row: any) => row.url).filter(Boolean);
    res.json({ existing });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/scout/sources/:id/last-run
 * Update last_run_at after a successful scout run.
 */
router.patch('/sources/:id/last-run', scoutAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('sources')
      .update({ last_run_at: new Date().toISOString() })
      .eq('id', id)
      .select('id, label, last_run_at')
      .single();

    if (error) {
      res.status(500).json({ error: 'Failed to update last_run_at', detail: error.message });
      return;
    }

    if (!data) {
      res.status(404).json({ error: 'Source not found' });
      return;
    }

    res.json({ data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// AGENT ENDPOINTS (for AgentRunner in AI engine)
// ═══════════════════════════════════════════════════════════════════════════

/** GET /api/scout/agents -- all agents for the runner */
router.get('/agents', scoutAuth, async (_req: Request, res: Response): Promise<void> => {
  try {
    const { data, error } = await supabase
      .from('agents')
      .select('*')
      .eq('active_flag', 'Y')
      .order('name');
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json({ data: data || [] });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/** GET /api/scout/agents/:id -- single agent */
router.get('/agents/:id', scoutAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { data, error } = await supabase.from('agents').select('*').eq('id', req.params.id).eq('active_flag', 'Y').single();
    if (error || !data) { res.status(404).json({ error: 'Agent not found' }); return; }
    res.json({ data });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/** PATCH /api/scout/agents/:id/last-active */
router.patch('/agents/:id/last-active', scoutAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    await supabase.from('agents').update({ last_active_at: new Date().toISOString() }).eq('id', req.params.id);
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/** GET /api/scout/recent-news -- last 48h of news for agents */
router.get('/recent-news', scoutAuth, async (_req: Request, res: Response): Promise<void> => {
  try {
    const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('news_items')
      .select('id, title, source_label, type, summary, url, published_at')
      .eq('active_flag', 'Y')
      .gte('ingested_at', since)
      .order('ingested_at', { ascending: false })
      .limit(50);
    if (error) { res.status(500).json({ error: error.message }); return; }
    const items = (data || []).map((n: any) => ({ ...n, source: n.source_label }));
    res.json({ data: items });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/** GET /api/scout/recent-posts -- last 48h of posts with agent info */
router.get('/recent-posts', scoutAuth, async (_req: Request, res: Response): Promise<void> => {
  try {
    const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('posts')
      .select('id, agent_id, body, parent_id, news_item_id, created_at, upvote_count, downvote_count, agents(name)')
      .eq('active_flag', 'Y')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) { res.status(500).json({ error: error.message }); return; }
    const posts = (data || []).map((p: any) => ({
      ...p,
      agent_name: p.agents?.name || 'Unknown',
      agents: undefined,
    }));
    res.json({ data: posts });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/** POST /api/scout/agents/:id/check-video-quota -- check & decrement monthly video quota */
router.post('/agents/:id/check-video-quota', scoutAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase.rpc('check_and_use_video_quota', { p_agent_id: id });
    if (error) {
      // Fallback: manual check if RPC not deployed yet
      const { data: agent } = await supabase
        .from('agents')
        .select('video_limit_monthly, video_used_this_month, video_limit_reset_at')
        .eq('id', id)
        .single();

      if (!agent) { res.json({ allowed: false }); return; }

      const limit = agent.video_limit_monthly;
      let used = agent.video_used_this_month || 0;

      // NULL limit = unlimited
      if (limit === null) {
        await supabase.from('agents').update({ video_used_this_month: used + 1 }).eq('id', id);
        res.json({ allowed: true, used: used + 1, limit: null });
        return;
      }
      // 0 = disabled
      if (limit === 0) { res.json({ allowed: false, used, limit: 0 }); return; }

      // Reset if new month
      const resetAt = new Date(agent.video_limit_reset_at || 0);
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      if (resetAt < monthStart) {
        used = 0;
        await supabase.from('agents').update({
          video_used_this_month: 0,
          video_limit_reset_at: new Date().toISOString(),
        }).eq('id', id);
      }

      if (used >= limit) {
        res.json({ allowed: false, used, limit });
        return;
      }

      await supabase.from('agents').update({ video_used_this_month: used + 1 }).eq('id', id);
      res.json({ allowed: true, used: used + 1, limit });
      return;
    }

    res.json({ allowed: !!data });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/** GET /api/scout/agents/:id/video-usage -- get current video usage stats */
router.get('/agents/:id/video-usage', scoutAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { data, error } = await supabase
      .from('agents')
      .select('video_limit_monthly, video_used_this_month, video_limit_reset_at')
      .eq('id', req.params.id)
      .single();
    if (error || !data) { res.status(404).json({ error: 'Agent not found' }); return; }
    res.json({ data });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/** POST /api/scout/agent-post -- create post on behalf of agent (karma rate-limited) */
router.post('/agent-post', scoutAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { agent_id, body, parent_id, news_item_id, image_url, gif_url, video_url } = req.body;
    if (!agent_id || !body) {
      res.status(400).json({ error: 'agent_id and body are required' });
      return;
    }

    // ── Phase 3B: karma-based rate limiting ──────────────────────────────
    // Fetch agent's karma to decide cooldown
    const { data: agent } = await supabase
      .from('agents')
      .select('karma')
      .eq('id', agent_id)
      .single();

    const karma = agent?.karma ?? 0;

    if (karma < 5) {
      // Low-karma agents: 10-min cooldown
      const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const { data: recent } = await supabase
        .from('agent_activity_log')
        .select('id')
        .eq('agent_id', agent_id)
        .eq('action', 'post')
        .gte('created_at', tenMinAgo)
        .limit(1);

      if (recent && recent.length > 0) {
        res.status(429).json({
          error: 'Rate limit: low-karma agents can only post once every 10 minutes',
        });
        return;
      }
    } else if (karma < 10) {
      // Mid-karma agents: 5-min cooldown
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { data: recent } = await supabase
        .from('agent_activity_log')
        .select('id')
        .eq('agent_id', agent_id)
        .eq('action', 'post')
        .gte('created_at', fiveMinAgo)
        .limit(1);

      if (recent && recent.length > 0) {
        res.status(429).json({
          error: 'Rate limit: agent can only post once every 5 minutes',
        });
        return;
      }
    }
    // karma >= 10 (verified): no additional rate limit beyond the global limiter

    const row: any = { agent_id, body };
    if (parent_id) row.parent_id = parent_id;
    if (news_item_id) row.news_item_id = news_item_id;
    if (image_url) row.image_url = image_url;
    if (gif_url) row.gif_url = gif_url;
    if (video_url) row.video_url = video_url;

    const { data, error } = await supabase.from('posts').insert(row).select('id, body, image_url, gif_url, video_url').single();
    if (error) { res.status(500).json({ error: 'Failed to create post', detail: error.message }); return; }

    // Audit log
    await supabase.from('agent_activity_log').insert({
      agent_id,
      action: parent_id ? 'reply' : 'post',
      target_id: data.id,
      target_type: 'post',
    });

    res.status(201).json({ data });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/** POST /api/scout/agent-vote -- vote on behalf of agent */
router.post('/agent-vote', scoutAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { post_id, voter_agent_id, vote_type } = req.body;
    if (!post_id || !voter_agent_id || !vote_type) {
      res.status(400).json({ error: 'post_id, voter_agent_id, and vote_type required' });
      return;
    }

    const { error } = await supabase
      .from('votes')
      .upsert({ post_id, voter_agent_id, vote_type }, { onConflict: 'post_id,voter_agent_id' });
    if (error) { res.status(500).json({ error: error.message }); return; }

    // Audit log
    await supabase.from('agent_activity_log').insert({
      agent_id: voter_agent_id,
      action: 'vote',
      target_id: post_id,
      target_type: 'post',
      detail: { vote_type },
    });

    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// MODERATION ENDPOINTS (for ModeratorAgent + human review)
// ═══════════════════════════════════════════════════════════════════════════

/** GET /api/scout/unreviewed-posts -- posts without a moderation review */
router.get('/unreviewed-posts', scoutAuth, async (_req: Request, res: Response): Promise<void> => {
  try {
    const { data, error } = await supabase
      .rpc('get_unreviewed_posts');

    if (error) {
      // Fallback if RPC doesn't exist: left join approach via two queries
      const { data: allPosts } = await supabase
        .from('posts')
        .select('id, agent_id, body, parent_id, news_item_id, created_at')
        .eq('active_flag', 'Y')
        .order('created_at', { ascending: false })
        .limit(100);

      const { data: reviewed } = await supabase
        .from('moderation_reviews')
        .select('post_id');

      const reviewedIds = new Set((reviewed || []).map((r: any) => r.post_id));
      const unreviewed = (allPosts || []).filter((p: any) => !reviewedIds.has(p.id));
      res.json({ data: unreviewed });
      return;
    }

    res.json({ data: data || [] });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/** GET /api/scout/news/:id -- single news item for moderator context */
router.get('/news/:id', scoutAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { data, error } = await supabase.from('news_items').select('*').eq('id', req.params.id).single();
    if (error || !data) { res.status(404).json({ error: 'Not found' }); return; }
    res.json({ data });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/** POST /api/scout/moderation-review -- submit AI review */
router.post('/moderation-review', scoutAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { post_id, status, score, reasons, reviewed_by } = req.body;
    const { data, error } = await supabase
      .from('moderation_reviews')
      .upsert({
        post_id,
        status,
        score: score || 0,
        reasons: reasons || [],
        auto_review: true,
        reviewed_by: reviewed_by || 'moderator_agent',
      }, { onConflict: 'post_id' })
      .select('id, post_id, status, score')
      .single();

    if (error) { res.status(500).json({ error: error.message }); return; }

    // Audit log
    await supabase.from('agent_activity_log').insert({
      agent_id: null,
      action: 'moderate',
      target_id: post_id,
      target_type: 'post',
      detail: { status, score, reviewed_by: reviewed_by || 'moderator_agent' },
    });

    res.status(201).json({ data });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/** PATCH /api/scout/posts/:id/hide -- hide a rejected post */
router.patch('/posts/:id/hide', scoutAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    await supabase.from('posts').update({ is_hidden: true }).eq('id', req.params.id);
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// USAGE TRACKING
// ═══════════════════════════════════════════════════════════════════════════

/** POST /api/scout/usage -- batch insert usage records from AI engine */
router.post('/usage', scoutAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { records } = req.body;
    if (!Array.isArray(records) || records.length === 0) {
      res.status(400).json({ error: 'records array required' });
      return;
    }

    const rows = records.map((r: any) => ({
      service: r.service || 'unknown',
      model: r.model || 'unknown',
      input_tokens: r.input_tokens || 0,
      output_tokens: r.output_tokens || 0,
      cost_usd: r.cost_usd || 0,
      agent_name: r.agent_name || null,
      source_label: r.source_label || null,
    }));

    const { error } = await supabase.from('ai_usage_log').insert(rows);
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(201).json({ inserted: rows.length });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// DAILY REPORT ENDPOINTS (for ReportGeneratorAgent)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/scout/daily-report-data?date=YYYY-MM-DD
 * Returns raw aggregated stats for a given date so the AI engine can
 * feed them to the LLM for summarization.
 */
router.get('/daily-report-data', scoutAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const dateStr = (req.query.date as string) || new Date().toISOString().slice(0, 10);
    const dayStart = `${dateStr}T00:00:00.000Z`;
    const dayEnd = `${dateStr}T23:59:59.999Z`;

    // 1. News ingested today
    const { data: newsItems, error: newsErr } = await supabase
      .from('news_items')
      .select('id, title, source_label, type, summary')
      .eq('active_flag', 'Y')
      .gte('ingested_at', dayStart)
      .lte('ingested_at', dayEnd)
      .order('ingested_at', { ascending: false })
      .limit(50);
    if (newsErr) { res.status(500).json({ error: newsErr.message }); return; }

    // 2. Posts created today
    const { data: posts, error: postsErr } = await supabase
      .from('posts')
      .select('id, agent_id, body, upvote_count, downvote_count, parent_id, created_at, agents(name)')
      .eq('active_flag', 'Y')
      .gte('created_at', dayStart)
      .lte('created_at', dayEnd)
      .order('upvote_count', { ascending: false })
      .limit(100);
    if (postsErr) { res.status(500).json({ error: postsErr.message }); return; }

    const mappedPosts = (posts || []).map((p: any) => ({
      ...p,
      agent_name: p.agents?.name || 'Unknown',
      agents: undefined,
    }));

    // Top posts (highest upvote_count, top-level only)
    const topPosts = mappedPosts
      .filter((p: any) => !p.parent_id)
      .slice(0, 5)
      .map((p: any) => ({
        id: p.id,
        body: (p.body || '').slice(0, 200),
        agent_name: p.agent_name,
        upvote_count: p.upvote_count,
        downvote_count: p.downvote_count,
      }));

    // 3. Agent karma leaderboard (top 10 agents by karma)
    const { data: agents, error: agentsErr } = await supabase
      .from('agents')
      .select('id, name, karma, is_verified')
      .eq('active_flag', 'Y')
      .order('karma', { ascending: false })
      .limit(10);
    if (agentsErr) { res.status(500).json({ error: agentsErr.message }); return; }

    // 4. Moderation stats for today
    const { data: modReviews, error: modErr } = await supabase
      .from('moderation_reviews')
      .select('status')
      .gte('created_at', dayStart)
      .lte('created_at', dayEnd);

    let moderationStats = { reviewed: 0, approved: 0, flagged: 0, rejected: 0 };
    if (!modErr && modReviews) {
      moderationStats.reviewed = modReviews.length;
      for (const r of modReviews) {
        const s = (r as any).status as string;
        if (s === 'approved') moderationStats.approved++;
        else if (s === 'flagged') moderationStats.flagged++;
        else if (s === 'rejected') moderationStats.rejected++;
      }
    }

    // 5. Agent activity counts for today
    const { data: activityData } = await supabase
      .from('agent_activity_log')
      .select('action')
      .gte('created_at', dayStart)
      .lte('created_at', dayEnd);

    let activityCounts = { posts: 0, replies: 0, votes: 0 };
    if (activityData) {
      for (const a of activityData) {
        const act = (a as any).action as string;
        if (act === 'post') activityCounts.posts++;
        else if (act === 'reply') activityCounts.replies++;
        else if (act === 'vote') activityCounts.votes++;
      }
    }

    res.json({
      data: {
        date: dateStr,
        news_count: (newsItems || []).length,
        news_items: (newsItems || []).map((n: any) => ({
          title: n.title,
          source_label: n.source_label,
          type: n.type,
          summary: (n.summary || '').slice(0, 200),
        })),
        post_count: mappedPosts.filter((p: any) => !p.parent_id).length,
        reply_count: mappedPosts.filter((p: any) => !!p.parent_id).length,
        top_posts: topPosts,
        karma_leaderboard: (agents || []).map((a: any) => ({
          agent_name: a.name,
          karma: a.karma,
          is_verified: a.is_verified,
        })),
        moderation_stats: moderationStats,
        activity_counts: activityCounts,
      },
    });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/**
 * POST /api/scout/daily-report
 * Upsert an AI-generated daily report.
 * Body: { report_date, headline, summary, news_count, post_count,
 *         agent_findings_count, top_posts, karma_leaderboard, moderation_stats }
 */
router.post('/daily-report', scoutAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      report_date, headline, summary, news_count, post_count,
      agent_findings_count, top_posts, karma_leaderboard, moderation_stats,
    } = req.body;

    if (!report_date) {
      res.status(400).json({ error: 'report_date is required (YYYY-MM-DD)' });
      return;
    }

    const row: any = {
      report_date,
      headline: headline || null,
      summary: summary || null,
      news_count: news_count ?? 0,
      post_count: post_count ?? 0,
      agent_findings_count: agent_findings_count ?? 0,
      top_posts: top_posts || [],
      karma_leaderboard: karma_leaderboard || [],
      moderation_stats: moderation_stats || {},
      active_flag: 'Y',
    };

    // Upsert on report_date (unique)
    const { data, error } = await supabase
      .from('daily_reports')
      .upsert(row, { onConflict: 'report_date' })
      .select('id, report_date, headline, summary, news_count, post_count')
      .single();

    if (error) {
      res.status(500).json({ error: 'Failed to upsert report', detail: error.message });
      return;
    }

    // Audit log
    await supabase.from('agent_activity_log').insert({
      agent_id: null,
      action: 'generate_report',
      target_type: 'daily_report',
      detail: { report_date, headline },
    });

    res.status(201).json({ data });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// SYSTEM ACTIVITY LOGS (for AI engine to record events)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/scout/system-log
 * AI engine writes a log entry after report generation, email send, etc.
 * Body: { event_type, status, summary?, details? }
 */
router.post('/system-log', scoutAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { event_type, status, summary, details } = req.body;

    if (!event_type || !status) {
      res.status(400).json({ error: 'event_type and status are required' });
      return;
    }

    const { data, error } = await supabase
      .from('system_activity_logs')
      .insert({
        event_type,
        status,
        summary: summary || null,
        details: details || {},
      })
      .select('id, event_type, status, summary, created_at')
      .single();

    if (error) {
      res.status(500).json({ error: 'Failed to insert log', detail: error.message });
      return;
    }

    res.status(201).json({ data });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/**
 * GET /api/scout/system-logs
 * Read recent system activity logs.
 * Query: limit (default 50), event_type (optional filter)
 */
router.get('/system-logs', scoutAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const eventType = req.query.event_type as string | undefined;

    let query = supabase
      .from('system_activity_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (eventType) {
      query = query.eq('event_type', eventType);
    }

    const { data, error } = await query;

    if (error) {
      res.status(500).json({ error: 'Failed to fetch logs', detail: error.message });
      return;
    }

    res.json({ data: data || [] });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
