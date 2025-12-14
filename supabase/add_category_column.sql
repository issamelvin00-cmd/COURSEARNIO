-- Add category and short_description columns to courses table
ALTER TABLE courses ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS short_description TEXT;

-- Update existing courses to have a default category if needed (optional)
-- UPDATE courses SET category = 'other' WHERE category IS NULL;
