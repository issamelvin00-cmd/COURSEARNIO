-- =============================================
-- CHAPTERS SCHEMA FOR EARNIO
-- Run this in Supabase SQL Editor
-- =============================================

-- Chapters table (stores course content)
CREATE TABLE IF NOT EXISTS chapters (
    id SERIAL PRIMARY KEY,
    course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    category TEXT,
    content_html TEXT,
    order_num INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast chapter lookups
CREATE INDEX IF NOT EXISTS idx_chapters_course_id ON chapters(course_id);
CREATE INDEX IF NOT EXISTS idx_chapters_order ON chapters(course_id, order_num);

-- User reading progress (lightweight - tracks last viewed chapter)
CREATE TABLE IF NOT EXISTS chapter_progress (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL,
    course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    last_chapter_id INTEGER REFERENCES chapters(id) ON DELETE SET NULL,
    completed_chapters INTEGER[] DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, course_id)
);

-- Index for progress lookups
CREATE INDEX IF NOT EXISTS idx_progress_user ON chapter_progress(user_id);

-- Enable RLS
ALTER TABLE chapters ENABLE ROW LEVEL SECURITY;
ALTER TABLE chapter_progress ENABLE ROW LEVEL SECURITY;

-- Chapters: Anyone can read (public courses)
CREATE POLICY "Chapters are viewable by everyone" ON chapters
    FOR SELECT USING (true);

-- Chapters: Only admins can modify
CREATE POLICY "Admins can manage chapters" ON chapters
    FOR ALL USING (
        EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true)
    );

-- Progress: Users can only access their own progress
CREATE POLICY "Users can view own progress" ON chapter_progress
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update own progress" ON chapter_progress
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can modify own progress" ON chapter_progress
    FOR UPDATE USING (auth.uid() = user_id);
