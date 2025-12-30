-- ===================================
-- TIERED REFERRAL SYSTEM
-- ===================================
-- Run this in Supabase SQL Editor

-- Referral tier configuration table
CREATE TABLE IF NOT EXISTS referral_tier_config (
    id SERIAL PRIMARY KEY,
    tier_name TEXT NOT NULL,
    min_referrals INTEGER NOT NULL DEFAULT 0,
    commission_percent INTEGER NOT NULL DEFAULT 20,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default tiers
INSERT INTO referral_tier_config (tier_name, min_referrals, commission_percent) VALUES
    ('Bronze', 0, 20),
    ('Silver', 10, 30),
    ('Gold', 50, 40)
ON CONFLICT DO NOTHING;

-- Function to get user's current commission rate based on their referral count
CREATE OR REPLACE FUNCTION get_user_commission_rate(user_uuid UUID)
RETURNS INTEGER AS $$
DECLARE
    referral_count INTEGER;
    commission INTEGER;
BEGIN
    -- Count confirmed referrals for this user
    SELECT COUNT(*) INTO referral_count
    FROM referrals
    WHERE referrer_id = user_uuid AND status = 'paid';
    
    -- Get the highest tier the user qualifies for
    SELECT commission_percent INTO commission
    FROM referral_tier_config
    WHERE min_referrals <= referral_count
    ORDER BY min_referrals DESC
    LIMIT 1;
    
    RETURN COALESCE(commission, 20); -- Default to 20% if no tier found
END;
$$ LANGUAGE plpgsql;

-- Function to get user's tier info
CREATE OR REPLACE FUNCTION get_user_tier_info(user_uuid UUID)
RETURNS TABLE(
    tier_name TEXT,
    commission_percent INTEGER,
    current_referrals INTEGER,
    next_tier_name TEXT,
    referrals_to_next_tier INTEGER
) AS $$
DECLARE
    ref_count INTEGER;
    current_tier RECORD;
    next_tier RECORD;
BEGIN
    -- Count confirmed referrals
    SELECT COUNT(*) INTO ref_count
    FROM referrals
    WHERE referrer_id = user_uuid AND status = 'paid';
    
    -- Get current tier
    SELECT * INTO current_tier
    FROM referral_tier_config
    WHERE min_referrals <= ref_count
    ORDER BY min_referrals DESC
    LIMIT 1;
    
    -- Get next tier
    SELECT * INTO next_tier
    FROM referral_tier_config
    WHERE min_referrals > ref_count
    ORDER BY min_referrals ASC
    LIMIT 1;
    
    RETURN QUERY SELECT 
        COALESCE(current_tier.tier_name, 'Bronze'),
        COALESCE(current_tier.commission_percent, 20),
        ref_count,
        next_tier.tier_name,
        CASE 
            WHEN next_tier.min_referrals IS NOT NULL 
            THEN next_tier.min_referrals - ref_count
            ELSE 0
        END;
END;
$$ LANGUAGE plpgsql;

-- Index for faster referral counting
CREATE INDEX IF NOT EXISTS idx_referrals_referrer_status ON referrals(referrer_id, status);
