-- ===================================
-- WALLET ENHANCEMENTS
-- ===================================
-- Run this in Supabase SQL Editor

-- Add pending balance and auto-payout threshold to wallets
ALTER TABLE wallets 
ADD COLUMN IF NOT EXISTS pending_balance_units INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS auto_payout_threshold INTEGER DEFAULT 0;

-- Create a view for earnings breakdown by course
CREATE OR REPLACE VIEW user_earnings_breakdown AS
SELECT 
    t.user_id,
    t.metadata->>'course_id' as course_id,
    c.title as course_title,
    t.metadata->>'type' as earning_type,
    SUM(t.amount_units) as total_units,
    COUNT(*) as transaction_count,
    MAX(t.created_at) as last_earned_at
FROM transactions t
LEFT JOIN courses c ON (t.metadata->>'course_id')::bigint = c.id
WHERE t.status = 'success' 
  AND t.metadata->>'type' IN ('course_commission', 'referral_bonus')
GROUP BY t.user_id, t.metadata->>'course_id', c.title, t.metadata->>'type';

-- Wallet settings table for user preferences
CREATE TABLE IF NOT EXISTS wallet_settings (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID UNIQUE NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    auto_withdraw_enabled BOOLEAN DEFAULT FALSE,
    auto_withdraw_threshold INTEGER DEFAULT 50000, -- 500 KES in units
    preferred_phone TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE wallet_settings ENABLE ROW LEVEL SECURITY;

-- Policies for wallet_settings
CREATE POLICY "Users can view own wallet settings"
    ON wallet_settings FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can update own wallet settings"
    ON wallet_settings FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own wallet settings"
    ON wallet_settings FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_wallet_settings_user ON wallet_settings(user_id);

-- Trigger to update updated_at
CREATE TRIGGER update_wallet_settings_updated_at 
    BEFORE UPDATE ON wallet_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
