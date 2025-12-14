const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Missing Supabase environment variables. Please check your .env.local file.');
    process.exit(1);
}

/**
 * Supabase client with service role key
 * Use for admin operations that bypass RLS
 * NEVER expose this to the client side
 */
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

/**
 * Supabase client with anon key
 * Use for regular user operations
 * RLS policies will be enforced
 */
const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Create a Supabase client for a specific user (with their JWT)
 * This ensures RLS policies apply correctly for that user
 * @param {string} accessToken - User's Supabase access token
 */
function createUserClient(accessToken) {
    return createClient(supabaseUrl, supabaseAnonKey, {
        global: {
            headers: {
                Authorization: `Bearer ${accessToken}`
            }
        }
    });
}

/**
 * Helper to get user from Supabase token
 * @param {string} token - JWT token from Authorization header
 * @returns {Promise<{user: object, error: object}>}
 */
async function getUserFromToken(token) {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    return { user, error };
}

module.exports = {
    supabase,           // For general anon operations
    supabaseAdmin,      // For admin/service operations
    createUserClient,   // Create client for specific user
    getUserFromToken    // Verify and get user from token
};
