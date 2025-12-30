-- =============================================
-- ENHANCED CHAPTER SCHEMA
-- Run this in Supabase SQL Editor
-- =============================================

-- 1. Chapter Tasks Table
-- Tasks that must be completed to finish a chapter
CREATE TABLE IF NOT EXISTS chapter_tasks (
    id SERIAL PRIMARY KEY,
    chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    type TEXT DEFAULT 'checkbox', -- 'checkbox' (manual), 'video_watch' (auto), 'link_click' (auto)
    verification_data TEXT, -- Stores specific data needed for verification (e.g., video URL or duration)
    order_num INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Chapter Resources Table
-- Specific resources attached to a chapter
CREATE TABLE IF NOT EXISTS chapter_resources (
    id SERIAL PRIMARY KEY,
    chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    type TEXT NOT NULL, -- 'video', 'tool', 'document'
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    description TEXT,
    order_num INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. User Task Progress Table
-- Tracks which specific tasks a user has completed
CREATE TABLE IF NOT EXISTS user_task_progress (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL,
    task_id INTEGER NOT NULL REFERENCES chapter_tasks(id) ON DELETE CASCADE,
    completed_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, task_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_chapter_tasks_chapter ON chapter_tasks(chapter_id);
CREATE INDEX IF NOT EXISTS idx_chapter_resources_chapter ON chapter_resources(chapter_id);
CREATE INDEX IF NOT EXISTS idx_user_task_progress_user ON user_task_progress(user_id);

-- RLS Policies

-- Enable RLS
ALTER TABLE chapter_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE chapter_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_task_progress ENABLE ROW LEVEL SECURITY;

-- Public can read tasks & resources
CREATE POLICY "Public read access tasks" ON chapter_tasks FOR SELECT USING (true);
CREATE POLICY "Public read access resources" ON chapter_resources FOR SELECT USING (true);

-- Admins can manage tasks & resources
CREATE POLICY "Admins manage tasks" ON chapter_tasks FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true)
);

CREATE POLICY "Admins manage resources" ON chapter_resources FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true)
);

-- Users manage their own progress
CREATE POLICY "Users view own task progress" ON user_task_progress FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users update own task progress" ON user_task_progress FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own task progress" ON user_task_progress FOR DELETE USING (auth.uid() = user_id);
