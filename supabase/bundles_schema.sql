-- ===================================
-- COURSE BUNDLES SCHEMA
-- ===================================
-- Run this in Supabase SQL Editor

-- Course bundles table
CREATE TABLE IF NOT EXISTS course_bundles (
    id BIGSERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    thumbnail_url TEXT,
    original_price INTEGER NOT NULL, -- Combined price of all courses
    bundle_price INTEGER NOT NULL, -- Discounted bundle price
    discount_percent INTEGER GENERATED ALWAYS AS 
        (CASE WHEN original_price > 0 THEN ((original_price - bundle_price) * 100 / original_price) ELSE 0 END) STORED,
    is_published BOOLEAN DEFAULT FALSE,
    created_by UUID REFERENCES profiles(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Junction table for courses in bundles
CREATE TABLE IF NOT EXISTS bundle_courses (
    id BIGSERIAL PRIMARY KEY,
    bundle_id BIGINT NOT NULL REFERENCES course_bundles(id) ON DELETE CASCADE,
    course_id BIGINT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    order_index INTEGER DEFAULT 0,
    UNIQUE(bundle_id, course_id)
);

-- Bundle purchases table
CREATE TABLE IF NOT EXISTS bundle_purchases (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    bundle_id BIGINT NOT NULL REFERENCES course_bundles(id) ON DELETE CASCADE,
    amount_paid INTEGER NOT NULL,
    transaction_ref TEXT,
    purchased_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, bundle_id)
);

-- Enable RLS
ALTER TABLE course_bundles ENABLE ROW LEVEL SECURITY;
ALTER TABLE bundle_courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE bundle_purchases ENABLE ROW LEVEL SECURITY;

-- Policies for course_bundles
CREATE POLICY "Anyone can view published bundles"
    ON course_bundles FOR SELECT
    USING (is_published = TRUE OR auth.uid() IS NOT NULL);

CREATE POLICY "Admins can manage bundles"
    ON course_bundles FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE id = auth.uid() AND is_admin = TRUE
        )
    );

-- Policies for bundle_courses
CREATE POLICY "Anyone can view bundle courses"
    ON bundle_courses FOR SELECT
    USING (TRUE);

CREATE POLICY "Admins can manage bundle courses"
    ON bundle_courses FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE id = auth.uid() AND is_admin = TRUE
        )
    );

-- Policies for bundle_purchases
CREATE POLICY "Users can view own bundle purchases"
    ON bundle_purchases FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Service can manage bundle purchases"
    ON bundle_purchases FOR ALL
    USING (TRUE);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_bundle_courses_bundle ON bundle_courses(bundle_id);
CREATE INDEX IF NOT EXISTS idx_bundle_courses_course ON bundle_courses(course_id);
CREATE INDEX IF NOT EXISTS idx_bundle_purchases_user ON bundle_purchases(user_id);
CREATE INDEX IF NOT EXISTS idx_bundle_purchases_bundle ON bundle_purchases(bundle_id);

-- Trigger for updated_at
CREATE TRIGGER update_course_bundles_updated_at 
    BEFORE UPDATE ON course_bundles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
