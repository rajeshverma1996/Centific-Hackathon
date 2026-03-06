import { Router, Request, Response } from 'express';
import * as reportsController from '../controllers/reportsController';
import { authenticate } from '../middleware/auth';
import { supabase } from '../config/supabase';

const router = Router();

// GET /api/reports          — user/admin
router.get('/', reportsController.list);

// GET /api/reports/logs     — activity logs for report generation & email
// NOTE: this must be before /:date so it doesn't match as a date param
router.get('/logs', async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);

    const { data, error } = await supabase
      .from('system_activity_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      res.status(500).json({ error: 'Failed to fetch logs', detail: error.message });
      return;
    }

    res.json({ data: data || [] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/reports/generate — trigger AI report generation (must be before /:date)
// authenticate is used so we can extract the logged-in user's email for notifications
router.post('/generate', authenticate, reportsController.generate);

// GET /api/reports/:date    — user/admin
router.get('/:date', reportsController.getByDate);

export default router;


