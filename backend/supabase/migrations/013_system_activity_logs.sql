-- Migration: 013_system_activity_logs.sql
-- Description: Creates a system_activity_logs table to track report generation,
--              email delivery, and other system events with success/failure details.

CREATE TABLE IF NOT EXISTS system_activity_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type  text NOT NULL,        -- 'report_generation', 'email_sent', 'email_failed', 'email_skipped'
  status      text NOT NULL,        -- 'success', 'failure', 'skipped'
  summary     text,                 -- short human-readable message
  details     jsonb DEFAULT '{}',   -- structured data: recipients, errors, durations, report_date, etc.
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Index for efficient queries by event type and recency
CREATE INDEX idx_system_logs_type_created
  ON system_activity_logs(event_type, created_at DESC);

-- Index for general recency queries (UI listing)
CREATE INDEX idx_system_logs_created
  ON system_activity_logs(created_at DESC);

