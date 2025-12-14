const { supabase, getUserFromToken, supabaseAdmin } = require('./supabase');

/**
 * Middleware to authenticate requests using Supabase JWT
 * Verifies the token and attaches user to req.user
 */
async function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ message: 'Authentication required' });
    }

    try {
        const { user, error } = await getUserFromToken(token);

        if (error || !user) {
            return res.status(403).json({ message: 'Invalid or expired token' });
        }

        // Attach user to request
        req.user = {
            id: user.id,
            email: user.email,
            token: token
        };

        next();
    } catch (err) {
        console.error('Auth error:', err);
        return res.status(403).json({ message: 'Authentication failed' });
    }
}

/**
 * Middleware to require admin privileges
 * Must be used after authenticateToken
 */
async function requireAdmin(req, res, next) {
    if (!req.user || !req.user.id) {
        return res.status(401).json({ message: 'Authentication required' });
    }

    try {
        // Check if user is admin in profiles table
        const { data: profile, error } = await supabaseAdmin
            .from('profiles')
            .select('is_admin')
            .eq('id', req.user.id)
            .single();

        if (error || !profile || !profile.is_admin) {
            return res.status(403).json({ message: 'Admin access required' });
        }

        next();
    } catch (err) {
        console.error('Admin check error:', err);
        return res.status(403).json({ message: 'Authorization failed' });
    }
}

/**
 * Helper to check if a user is paid
 * @param {string} userId - User's UUID
 * @returns {Promise<boolean>}
 */
async function isUserPaid(userId) {
    const { data: profile, error } = await supabaseAdmin
        .from('profiles')
        .select('is_paid')
        .eq('id', userId)
        .single();

    if (error) {
        console.error('Error checking payment status:', error);
        return false;
    }

    return profile?.is_paid || false;
}

/**
 * Helper to check if user owns a course
 * @param {string} userId - User's UUID
 * @param {number} courseId - Course ID
 * @returns {Promise<boolean>}
 */
async function userOwnsCourse(userId, courseId) {
    // Check if admin first
    const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('is_admin')
        .eq('id', userId)
        .single();

    if (profile?.is_admin) return true;

    // Check purchase
    const { data, error } = await supabaseAdmin
        .from('course_purchases')
        .select('id')
        .eq('user_id', userId)
        .eq('course_id', courseId)
        .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = not found, not an error
        console.error('Error checking course ownership:', error);
        return false;
    }

    return !!data;
}

module.exports = {
    authenticateToken,
    requireAdmin,
    isUserPaid,
    userOwnsCourse
};
