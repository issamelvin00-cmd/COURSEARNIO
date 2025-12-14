-- Create task_submissions table
CREATE TABLE IF NOT EXISTS task_submissions (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID REFERENCES profiles(id) NOT NULL,
    task_id BIGINT REFERENCES admin_tasks(id) NOT NULL,
    status TEXT CHECK (status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
    proof_data TEXT, -- Can be URL or JSON or just text
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    reviewed_by UUID REFERENCES profiles(id)
);

-- Index for faster queries
CREATE INDEX idx_task_submissions_user_id ON task_submissions(user_id);
CREATE INDEX idx_task_submissions_status ON task_submissions(status);
