import { Request, Response } from 'express';
import { supabase } from '../config/supabase';

const AI_ENGINE_URL = process.env.AI_ENGINE_URL || 'http://localhost:5001';
const SCOUT_API_KEY = process.env.SCOUT_API_KEY || '';

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

/**
 * POST /api/reports/generate
 * Delegates report generation to the AI engine (LLM-powered headline + summary).
 * The AI agent always generates the report — no local fallback.
 * Also forwards the logged-in user's email so the AI engine can send a notification.
 *
 * Body: { date?: "YYYY-MM-DD" } — defaults to today (UTC) if omitted.
 */
export const generate = async (req: Request, res: Response): Promise<void> => {
  try {
    const dateStr =
      req.body?.date || new Date().toISOString().slice(0, 10);

    // Collect the logged-in user's email (if authenticated) for notification
    const notifyEmails: string[] = [];
    if (req.user?.email) {
      notifyEmails.push(req.user.email);
    }

    // ── Always delegate to the AI engine ─────────────────────────────
    const aiResp = await fetch(`${AI_ENGINE_URL}/api/reports/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Scout-Key': SCOUT_API_KEY,
      },
      body: JSON.stringify({
        date: dateStr,
        notify_emails: notifyEmails,
      }),
      signal: AbortSignal.timeout(120_000), // 2-minute timeout
    });

    const body = await aiResp.json();

    if (aiResp.ok) {
      res.json(body);
    } else {
      res.status(aiResp.status).json({
        error: 'AI engine failed to generate report',
        detail: body,
      });
    }

    // ── NOTE: Local fallback has been intentionally removed.
    // ── Report generation is always handled by the AI agent.

  } catch (err: any) {
    res.status(502).json({
      error: 'AI engine is unreachable. Please ensure the AI engine is running.',
      detail: err.message,
    });
  }
};

