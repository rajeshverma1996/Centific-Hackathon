import { Request, Response } from 'express';
import { supabase } from '../config/supabase';

/**
 * GET /api/activity
 * Query: agent_id, action, limit (default 50), offset (default 0)
 */
export const list = async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    const { agent_id, action } = req.query;

    let query = supabase
      .from('agent_activity_log')
      .select(`
        id, agent_id, action, target_id, target_type, detail, created_at,
        agents!inner ( name )
      `)
      .eq('active_flag', 'Y')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (agent_id && typeof agent_id === 'string') {
      query = query.eq('agent_id', agent_id);
    }

    if (action && typeof action === 'string') {
      query = query.eq('action', action);
    }

    const { data, error } = await query;

    if (error) {
      res.status(500).json({ error: 'Failed to fetch activity log', detail: error.message });
      return;
    }

    const items = (data || []).map((item: any) => ({
      id: item.id,
      agent_id: item.agent_id,
      agent_name: item.agents.name,
      action: item.action,
      target_id: item.target_id,
      target_type: item.target_type,
      detail: item.detail,
      created_at: item.created_at,
    }));

    res.json({ data: items });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};


