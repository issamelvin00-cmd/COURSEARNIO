-- Add video link columns to courses table
ALTER TABLE courses 
ADD COLUMN IF NOT EXISTS video_link_1 TEXT,
ADD COLUMN IF NOT EXISTS video_link_2 TEXT;

-- Verify
SELECT id, title, video_link_1, video_link_2 FROM courses LIMIT 1;
