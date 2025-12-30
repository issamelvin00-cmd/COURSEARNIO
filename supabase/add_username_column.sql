-- Add username column to profiles table
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS username TEXT UNIQUE;

-- create an index for faster lookups
CREATE INDEX IF NOT EXISTS idx_profiles_username ON profiles(username);
