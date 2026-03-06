import { Request, Response } from 'express';
import { supabase } from '../config/supabase';

/**
 * GET /api/news
 * Query: source (source_label filter), type, limit (default 20), offset (default 0)
 */
export const list = async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Number(req.query.offset) || 0;
    const { source, type } = req.query;
    const sortBy = (req.query.sort as string) || 'ingested_at';

    let query = supabase
      .from('news_items')
      .select('id, title, source_label, type, summary, url, metadata, published_at, ingested_at')
      .eq('active_flag', 'Y')
      .order(sortBy, { ascending: false })
      .range(offset, offset + limit - 1);

    if (source && typeof source === 'string') {
      query = query.ilike('source_label', `%${source}%`);
    }

    if (type && typeof type === 'string') {
      query = query.eq('type', type);
    }

    const { data, error } = await query;

    if (error) {
      res.status(500).json({ error: 'Failed to fetch news', detail: error.message });
      return;
    }

    // Map to match frontend NewsItem type
    const items = (data || []).map((item: any) => ({
      id: item.id,
      title: item.title,
      source: item.source_label,
      summary: item.summary,
      published_at: item.published_at,
      ingested_at: item.ingested_at,
      type: item.type,
      url: item.url,
      metadata: item.metadata,
    }));

    res.json({ data: items });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET /api/news/:id
 */
export const getById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('news_items')
      .select('*')
      .eq('id', id)
      .eq('active_flag', 'Y')
      .single();

    if (error || !data) {
      res.status(404).json({ error: 'News item not found' });
      return;
    }

    res.json({
      data: {
        ...data,
        source: data.source_label,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * POST /api/news
 * Body: { title, source_label, source_id?, type?, summary?, url?,
 *         raw_content?, metadata?, published_at }
 * Used by n8n/scouts to ingest news items.
 */
export const ingest = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      title, source_label, source_id, type, summary,
      url, raw_content, metadata, published_at,
    } = req.body;

    if (!title || !source_label || !published_at) {
      res.status(400).json({ error: 'title, source_label, and published_at are required' });
      return;
    }

    const { data, error } = await supabase
      .from('news_items')
      .insert({
        title,
        source_label,
        source_id: source_id || null,
        type: type || 'update',
        summary: summary || null,
        url: url || null,
        raw_content: raw_content || null,
        metadata: metadata || {},
        published_at,
      })
      .select('*')
      .single();

    if (error) {
      // Check for duplicate URL
      if (error.code === '23505') {
        res.status(409).json({ error: 'News item with this URL already exists' });
        return;
      }
      res.status(500).json({ error: 'Failed to ingest news item', detail: error.message });
      return;
    }

    res.status(201).json({ data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};


