import rateLimit from 'express-rate-limit';

/**
 * General API limiter: 1000 requests per 15 minutes per IP.
 * Increased from 100 to accommodate the AI engine's scheduled jobs
 * (scouts, agents, moderation, reports) which all run from localhost.
 */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

/**
 * Auth limiter: 10 requests per 15 minutes per IP.
 * Applied to /api/auth only (login, register, refresh).
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts, please try again later.' },
});


