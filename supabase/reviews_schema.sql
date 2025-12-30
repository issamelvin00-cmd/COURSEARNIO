-- ===================================
-- REVIEWS & RATINGS SCHEMA
-- ===================================
-- Run this in Supabase SQL Editor

-- Course reviews table
CREATE TABLE IF NOT EXISTS course_reviews (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    course_id BIGINT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    title TEXT,
    review_text TEXT,
    status TEXT DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
    admin_notes TEXT, -- For moderation notes
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, course_id)
);

-- Enable RLS
ALTER TABLE course_reviews ENABLE ROW LEVEL SECURITY;

-- Policies for course_reviews
-- Users can view approved reviews
CREATE POLICY "Anyone can view approved reviews"
    ON course_reviews FOR SELECT
    USING (status = 'approved');

-- Users can view their own reviews (any status)
CREATE POLICY "Users can view own reviews"
    ON course_reviews FOR SELECT
    USING (auth.uid() = user_id);

-- Users can create reviews only if they purchased the course
CREATE POLICY "Buyers can create reviews"
    ON course_reviews FOR INSERT
    WITH CHECK (
        auth.uid() = user_id AND
        EXISTS (
            SELECT 1 FROM course_purchases
            WHERE user_id = auth.uid() AND course_id = course_reviews.course_id
        )
    );

-- Users can update their own pending reviews
CREATE POLICY "Users can update own pending reviews"
    ON course_reviews FOR UPDATE
    USING (auth.uid() = user_id AND status = 'pending');

-- Admins can manage all reviews
CREATE POLICY "Admins can manage all reviews"
    ON course_reviews FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE id = auth.uid() AND is_admin = TRUE
        )
    );

-- Indexes
CREATE INDEX IF NOT EXISTS idx_reviews_course ON course_reviews(course_id);
CREATE INDEX IF NOT EXISTS idx_reviews_user ON course_reviews(user_id);
CREATE INDEX IF NOT EXISTS idx_reviews_status ON course_reviews(status);

-- Trigger for updated_at
CREATE TRIGGER update_course_reviews_updated_at 
    BEFORE UPDATE ON course_reviews
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- View for course rating aggregates
CREATE OR REPLACE VIEW course_ratings AS
SELECT 
    course_id,
    COUNT(*) as review_count,
    ROUND(AVG(rating), 1) as average_rating,
    COUNT(*) FILTER (WHERE rating = 5) as five_star,
    COUNT(*) FILTER (WHERE rating = 4) as four_star,
    COUNT(*) FILTER (WHERE rating = 3) as three_star,
    COUNT(*) FILTER (WHERE rating = 2) as two_star,
    COUNT(*) FILTER (WHERE rating = 1) as one_star
FROM course_reviews
WHERE status = 'approved'
GROUP BY course_id;
