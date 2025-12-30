-- ===================================
-- PROGRESS TRACKING & MILESTONES
-- ===================================
-- Run this in Supabase SQL Editor

-- Milestone definitions for courses
CREATE TABLE IF NOT EXISTS course_milestones (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL, -- '25% Complete', '50% Complete', etc.
    percent_threshold INTEGER NOT NULL, -- 25, 50, 75, 100
    reward_units INTEGER DEFAULT 0, -- Bonus for hitting milestone (optional)
    badge_icon TEXT, -- Icon name for badge display
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default milestones
INSERT INTO course_milestones (name, percent_threshold, reward_units, badge_icon) VALUES
    ('Getting Started', 25, 0, 'fa-seedling'),
    ('Halfway There', 50, 0, 'fa-fire'),
    ('Almost Done', 75, 0, 'fa-rocket'),
    ('Course Complete', 100, 0, 'fa-trophy')
ON CONFLICT DO NOTHING;

-- User achievements (earned milestones)
CREATE TABLE IF NOT EXISTS user_achievements (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    course_id BIGINT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    milestone_id BIGINT NOT NULL REFERENCES course_milestones(id) ON DELETE CASCADE,
    earned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    reward_claimed BOOLEAN DEFAULT FALSE,
    UNIQUE(user_id, course_id, milestone_id)
);

-- Enable RLS
ALTER TABLE user_achievements ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view own achievements"
    ON user_achievements FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Service can manage achievements"
    ON user_achievements FOR ALL
    USING (TRUE);

-- Course certificates
CREATE TABLE IF NOT EXISTS certificates (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    course_id BIGINT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    certificate_number TEXT UNIQUE NOT NULL,
    issued_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, course_id)
);

-- Enable RLS
ALTER TABLE certificates ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view own certificates"
    ON certificates FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Service can manage certificates"
    ON certificates FOR ALL
    USING (TRUE);

-- Function to calculate course progress percentage
CREATE OR REPLACE FUNCTION get_course_progress(p_user_id UUID, p_course_id BIGINT)
RETURNS TABLE(
    total_lessons INTEGER,
    completed_lessons INTEGER,
    progress_percent INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(l.id)::INTEGER as total_lessons,
        COUNT(lp.id) FILTER (WHERE lp.completed = TRUE)::INTEGER as completed_lessons,
        CASE 
            WHEN COUNT(l.id) = 0 THEN 0
            ELSE (COUNT(lp.id) FILTER (WHERE lp.completed = TRUE) * 100 / COUNT(l.id))::INTEGER
        END as progress_percent
    FROM lessons l
    LEFT JOIN lesson_progress lp ON l.id = lp.lesson_id AND lp.user_id = p_user_id
    WHERE l.course_id = p_course_id;
END;
$$ LANGUAGE plpgsql;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_user_achievements_user ON user_achievements(user_id);
CREATE INDEX IF NOT EXISTS idx_user_achievements_course ON user_achievements(course_id);
CREATE INDEX IF NOT EXISTS idx_certificates_user ON certificates(user_id);
CREATE INDEX IF NOT EXISTS idx_certificates_course ON certificates(course_id);
