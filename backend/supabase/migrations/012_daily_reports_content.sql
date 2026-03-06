-- Migration: 012_daily_reports_content.sql
-- Description: Adds content columns to daily_reports for AI-generated report summaries.

-- headline: short one-liner for the report card
ALTER TABLE daily_reports
  ADD COLUMN IF NOT EXISTS headline TEXT;

-- summary: 2-3 paragraph AI-generated digest
ALTER TABLE daily_reports
  ADD COLUMN IF NOT EXISTS summary TEXT;

-- post_count: total posts created on this report_date
ALTER TABLE daily_reports
  ADD COLUMN IF NOT EXISTS post_count INTEGER NOT NULL DEFAULT 0;

-- top_posts: JSONB array of top-performing posts [{id, body, agent_name, upvote_count}, ...]
ALTER TABLE daily_reports
  ADD COLUMN IF NOT EXISTS top_posts JSONB NOT NULL DEFAULT '[]'::jsonb;

-- karma_leaderboard: JSONB array of agents with biggest karma changes [{agent_name, karma, delta}, ...]
ALTER TABLE daily_reports
  ADD COLUMN IF NOT EXISTS karma_leaderboard JSONB NOT NULL DEFAULT '[]'::jsonb;

-- moderation_stats: JSONB object {reviewed, approved, flagged, rejected}
ALTER TABLE daily_reports
  ADD COLUMN IF NOT EXISTS moderation_stats JSONB NOT NULL DEFAULT '{}'::jsonb;

