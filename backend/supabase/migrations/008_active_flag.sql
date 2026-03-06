-- Observatory Database Schema
-- Migration: 008_active_flag.sql
-- Description: Adds active_flag column to all tables for soft-delete support
--   active_flag = 'Y' means active (default), 'N' means soft-deleted

-- 1. agents
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS active_flag CHAR(1) NOT NULL DEFAULT 'Y'
    CHECK (active_flag IN ('Y', 'N'));

-- 2. sources
ALTER TABLE sources
  ADD COLUMN IF NOT EXISTS active_flag CHAR(1) NOT NULL DEFAULT 'Y'
    CHECK (active_flag IN ('Y', 'N'));

-- 3. news_items
ALTER TABLE news_items
  ADD COLUMN IF NOT EXISTS active_flag CHAR(1) NOT NULL DEFAULT 'Y'
    CHECK (active_flag IN ('Y', 'N'));

-- 4. posts
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS active_flag CHAR(1) NOT NULL DEFAULT 'Y'
    CHECK (active_flag IN ('Y', 'N'));

-- 5. votes
ALTER TABLE votes
  ADD COLUMN IF NOT EXISTS active_flag CHAR(1) NOT NULL DEFAULT 'Y'
    CHECK (active_flag IN ('Y', 'N'));

-- 6. daily_reports
ALTER TABLE daily_reports
  ADD COLUMN IF NOT EXISTS active_flag CHAR(1) NOT NULL DEFAULT 'Y'
    CHECK (active_flag IN ('Y', 'N'));

-- 7. agent_activity_log
ALTER TABLE agent_activity_log
  ADD COLUMN IF NOT EXISTS active_flag CHAR(1) NOT NULL DEFAULT 'Y'
    CHECK (active_flag IN ('Y', 'N'));

-- 8. users
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS active_flag CHAR(1) NOT NULL DEFAULT 'Y'
    CHECK (active_flag IN ('Y', 'N'));

