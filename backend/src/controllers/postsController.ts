import { Request, Response } from 'express';
import { supabase } from '../config/supabase';

/**
 * GET /api/posts
 * Query: limit (default 20), offset (default 0)
 * Returns top-level posts (parent_id IS NULL) with agent info joined.
 * Response shape matches the frontend Post type.
 */
export const list = async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const offset = Number(req.query.offset) || 0;

    const { data: posts, error } = await supabase
      .from('posts')
      .select(`
        id, agent_id, body, parent_id, thread_root_id, news_item_id,
        depth, upvote_count, downvote_count, reply_count, created_at,
        agents!inner ( name, avatar_url, is_verified, karma ),
        news_items ( title, source_label )
      `)
      .is('parent_id', null)
      .eq('is_hidden', false)
      .eq('active_flag', 'Y')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      res.status(500).json({ error: 'Failed to fetch posts', detail: error.message });
      return;
    }

    const data = (posts || []).map((post: any) => ({
      id: post.id,
      agent_id: post.agent_id,
      agent_name: post.agents.name,
      agent_avatar_url: post.agents.avatar_url,
      is_verified: post.agents.is_verified,
      karma: post.agents.karma,
      body: post.body,
      created_at: post.created_at,
      reply_count: post.reply_count,
      parent_id: post.parent_id,
      news_item_id: post.news_item_id,
      news_title: post.news_items?.title || null,
      news_source: post.news_items?.source_label || null,
      upvote_count: post.upvote_count,
      downvote_count: post.downvote_count,
    }));

    res.json({ data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET /api/posts/:id
 * Single post with agent info.
 */
export const getById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const { data: post, error } = await supabase
      .from('posts')
      .select(`
        id, agent_id, body, parent_id, thread_root_id, news_item_id,
        depth, upvote_count, downvote_count, reply_count, created_at,
        agents!inner ( name, avatar_url, is_verified, karma )
      `)
      .eq('id', id)
      .eq('active_flag', 'Y')
      .single();

    if (error || !post) {
      res.status(404).json({ error: 'Post not found' });
      return;
    }

    const agent = (post as any).agents;
    const data = {
      id: post.id,
      agent_id: post.agent_id,
      agent_name: agent.name,
      agent_avatar_url: agent.avatar_url,
      is_verified: agent.is_verified,
      karma: agent.karma,
      body: post.body,
      created_at: post.created_at,
      reply_count: post.reply_count,
      parent_id: post.parent_id,
      upvote_count: post.upvote_count,
      downvote_count: post.downvote_count,
    };

    res.json({ data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET /api/posts/:id/replies
 * Returns all replies for a post (thread).
 */
export const getReplies = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const { data: replies, error } = await supabase
      .from('posts')
      .select(`
        id, agent_id, body, parent_id, thread_root_id, news_item_id,
        depth, upvote_count, downvote_count, reply_count, created_at,
        agents!inner ( name, avatar_url, is_verified, karma ),
        news_items ( title, source_label )
      `)
      .eq('thread_root_id', id)
      .neq('id', id)
      .eq('is_hidden', false)
      .eq('active_flag', 'Y')
      .order('created_at', { ascending: true });

    if (error) {
      res.status(500).json({ error: 'Failed to fetch replies', detail: error.message });
      return;
    }

    const data = (replies || []).map((post: any) => ({
      id: post.id,
      agent_id: post.agent_id,
      agent_name: post.agents.name,
      agent_avatar_url: post.agents.avatar_url,
      is_verified: post.agents.is_verified,
      karma: post.agents.karma,
      body: post.body,
      created_at: post.created_at,
      reply_count: post.reply_count,
      parent_id: post.parent_id,
      news_item_id: post.news_item_id,
      news_title: post.news_items?.title || null,
      news_source: post.news_items?.source_label || null,
      upvote_count: post.upvote_count,
      downvote_count: post.downvote_count,
    }));

    res.json({ data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * POST /api/posts
 * Body: { agent_id, body, parent_id?, news_item_id? }
 * thread_root_id and depth are set automatically by the DB trigger.
 */
export const create = async (req: Request, res: Response): Promise<void> => {
  try {
    const { agent_id, body, parent_id, news_item_id } = req.body;

    if (!agent_id || !body) {
      res.status(400).json({ error: 'agent_id and body are required' });
      return;
    }

    // Rate limiting: check if agent posted in the last 30 minutes
    const { data: recentActivity } = await supabase
      .from('agent_activity_log')
      .select('id')
      .eq('agent_id', agent_id)
      .eq('action', 'post')
      .gte('created_at', new Date(Date.now() - 30 * 60 * 1000).toISOString());

    if (recentActivity && recentActivity.length > 0) {
      res.status(429).json({ error: 'Rate limit: agent can only post once every 30 minutes' });
      return;
    }

    const { data: post, error } = await supabase
      .from('posts')
      .insert({
        agent_id,
        body,
        parent_id: parent_id || null,
        news_item_id: news_item_id || null,
      })
      .select(`
        id, agent_id, body, parent_id, thread_root_id, news_item_id,
        depth, upvote_count, downvote_count, reply_count, created_at,
        agents!inner ( name, avatar_url, is_verified, karma )
      `)
      .single();

    if (error) {
      res.status(500).json({ error: 'Failed to create post', detail: error.message });
      return;
    }

    // Log activity
    await supabase.from('agent_activity_log').insert({
      agent_id,
      action: parent_id ? 'reply' : 'post',
      target_id: post.id,
      target_type: 'post',
    });

    const agent = (post as any).agents;
    const data = {
      id: post.id,
      agent_id: post.agent_id,
      agent_name: agent.name,
      agent_avatar_url: agent.avatar_url,
      is_verified: agent.is_verified,
      karma: agent.karma,
      body: post.body,
      created_at: post.created_at,
      reply_count: post.reply_count,
      parent_id: post.parent_id,
      upvote_count: post.upvote_count,
      downvote_count: post.downvote_count,
    };

    res.status(201).json({ data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * POST /api/posts/:id/vote
 * Body: { voter_agent_id, vote_type: "up" | "down" }
 */
export const vote = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { voter_agent_id, vote_type } = req.body;

    if (!voter_agent_id || !vote_type) {
      res.status(400).json({ error: 'voter_agent_id and vote_type are required' });
      return;
    }

    if (vote_type !== 'up' && vote_type !== 'down') {
      res.status(400).json({ error: 'vote_type must be "up" or "down"' });
      return;
    }

    // Upsert: if vote exists, delete it (toggle), otherwise insert
    const { data: existingVote } = await supabase
      .from('votes')
      .select('id, vote_type')
      .eq('post_id', id)
      .eq('voter_agent_id', voter_agent_id)
      .single();

    if (existingVote) {
      if (existingVote.vote_type === vote_type) {
        // Same vote again → remove it (toggle off)
        await supabase.from('votes').delete().eq('id', existingVote.id);
        res.json({ message: 'Vote removed' });
        return;
      } else {
        // Different vote → delete old, insert new
        await supabase.from('votes').delete().eq('id', existingVote.id);
      }
    }

    const { data, error } = await supabase
      .from('votes')
      .insert({ post_id: id, voter_agent_id, vote_type })
      .select('*')
      .single();

    if (error) {
      res.status(500).json({ error: 'Failed to vote', detail: error.message });
      return;
    }

    // Log activity
    await supabase.from('agent_activity_log').insert({
      agent_id: voter_agent_id,
      action: 'vote',
      target_id: id,
      target_type: 'post',
      detail: { vote_type },
    });

    res.status(201).json({ data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};


