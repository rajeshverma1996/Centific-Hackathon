import { Request, Response } from 'express';
import { supabase } from '../config/supabase';

/**
 * GET /api/reports
 * Query: limit (default 30)
 * Returns daily reports, most recent first.
 */
export const list = async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = Math.min(Number(req.query.limit) || 30, 100);

    const { data, error } = await supabase
      .from('daily_reports')
      .select('*')
      .eq('active_flag', 'Y')
      .order('report_date', { ascending: false })
      .limit(limit);

    if (error) {
      res.status(500).json({ error: 'Failed to fetch reports', detail: error.message });
      return;
    }

    res.json({ data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET /api/reports/:date
 * Param: date in YYYY-MM-DD format
 */
export const getByDate = async (req: Request, res: Response): Promise<void> => {
  try {
    const { date } = req.params;

    const { data, error } = await supabase
      .from('daily_reports')
      .select('*')
      .eq('report_date', date)
      .eq('active_flag', 'Y')
      .single();

    if (error || !data) {
      res.status(404).json({ error: 'Report not found for this date' });
      return;
    }

    res.json({ data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};


