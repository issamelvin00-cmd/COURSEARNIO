const express = require('express');
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const axios = require('axios');
require('dotenv').config({ path: '.env.local' });

const { supabase, supabaseAdmin } = require('./lib/supabase');
const { authenticateToken, requireAdmin, isUserPaid, userOwnsCourse } = require('./lib/auth-helpers');

const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Request Logger
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

const PORT = process.env.PORT || 3000;
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;

// Constants
const PAYSTACK_UNIT = 100;
const SIGNUP_FEE_KES = 100;
const REFERRAL_REWARD_KES = 50;
const SIGNUP_FEE_UNITS = SIGNUP_FEE_KES * PAYSTACK_UNIT;
const REFERRAL_REWARD_UNITS = REFERRAL_REWARD_KES * PAYSTACK_UNIT;

if (!PAYSTACK_SECRET) {
    console.error('Missing PAYSTACK_SECRET_KEY');
}

// Log Paystack key status (show first 15 chars for debugging)
const paystackPublicKey = process.env.PAYSTACK_PUBLIC_KEY;
console.log('Paystack Public Key loaded:', paystackPublicKey ? `${paystackPublicKey.substring(0, 15)}...` : 'MISSING - using fallback');
console.log('Paystack Secret Key loaded:', PAYSTACK_SECRET ? 'YES' : 'NO');

// ===================================
// PAYSTACK WEBHOOK (Fail-proof payment processing)
// ===================================
// Configure this URL in your Paystack dashboard: https://dashboard.paystack.com/#/settings/developer
// Webhook URL: https://yourdomain.com/webhooks/paystack

app.post('/webhooks/paystack', express.raw({ type: 'application/json' }), async (req, res) => {
    const hash = crypto.createHmac('sha512', PAYSTACK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');

    // Verify webhook signature
    if (hash !== req.headers['x-paystack-signature']) {
        console.log('Invalid Paystack webhook signature');
        return res.status(401).send('Invalid signature');
    }

    const event = req.body;
    console.log('Paystack webhook received:', event.event);

    try {
        if (event.event === 'charge.success') {
            const data = event.data;
            const reference = data.reference;
            const metadata = data.metadata || {};
            const amount = data.amount;

            console.log('Payment success webhook:', { reference, metadata, amount });

            // Check transaction type from reference or metadata
            if (reference.startsWith('COURSE_')) {
                // Course purchase - extract course ID and user ID from reference
                // Format: COURSE_{courseId}_{timestamp}_{userId}
                const parts = reference.split('_');
                if (parts.length >= 4) {
                    const courseId = parts[1];
                    const userId = parts[3];

                    console.log('Course purchase webhook:', { courseId, userId });

                    // Check if already purchased
                    const { data: existing } = await supabaseAdmin
                        .from('course_purchases')
                        .select('id')
                        .eq('user_id', userId)
                        .eq('course_id', courseId)
                        .single();

                    if (!existing) {
                        // Grant course access
                        const { error: purchaseError } = await supabaseAdmin
                            .from('course_purchases')
                            .insert({
                                user_id: userId,
                                course_id: parseInt(courseId),
                                amount_paid: amount,
                                transaction_ref: reference
                            });

                        if (purchaseError) {
                            console.error('Webhook course purchase error:', purchaseError);
                        } else {
                            console.log('Course access granted via webhook');
                        }

                        // Also update any pending order
                        await supabaseAdmin
                            .from('course_orders')
                            .update({ status: 'approved', approved_at: new Date().toISOString() })
                            .eq('user_id', userId)
                            .eq('course_id', courseId)
                            .eq('status', 'pending');
                    }

                    // Update transaction status
                    await supabaseAdmin
                        .from('transactions')
                        .update({ status: 'success' })
                        .eq('reference', reference);
                }
            } else if (reference.startsWith('EARNIO_')) {
                // Membership signup - handled elsewhere but update transaction
                await supabaseAdmin
                    .from('transactions')
                    .update({ status: 'success' })
                    .eq('reference', reference);
            }
        }

        res.status(200).send('OK');
    } catch (err) {
        console.error('Webhook processing error:', err);
        res.status(500).send('Error');
    }
});

// ===================================
// AUTH ENDPOINTS
// ===================================

app.post('/auth/signup', async (req, res) => {
    const { email, password, referralCode } = req.body;
    if (!email || !password) {
        return res.status(400).json({ message: 'Email and password required' });
    }

    try {
        // Create user in Supabase Auth
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true // Auto-confirm for now
        });

        if (authError) {
            console.error('Signup error:', authError);
            return res.status(400).json({ message: authError.message || 'Signup failed' });
        }

        const userId = authData.user.id;
        const userRefCode = 'USER' + Date.now().toString().slice(-6);

        // Find referrer if referral code provided
        let referrerId = null;
        if (referralCode) {
            const { data: referrer } = await supabaseAdmin
                .from('profiles')
                .select('id')
                .eq('referral_code', referralCode)
                .single();

            referrerId = referrer?.id || null;
        }

        // Check if this is the first user (make them admin)
        const { count } = await supabaseAdmin
            .from('profiles')
            .select('*', { count: 'exact', head: true });

        const isAdmin = count === 0;

        // Create profile
        const { error: profileError } = await supabaseAdmin
            .from('profiles')
            .insert({
                id: userId,
                email,
                referral_code: userRefCode,
                referred_by: referrerId,
                is_admin: isAdmin,
                is_paid: isAdmin // Skip payment for admin
            });

        if (profileError) {
            console.error('Profile creation error:', profileError);
            // Cleanup: delete auth user if profile creation failed
            await supabaseAdmin.auth.admin.deleteUser(userId);
            return res.status(500).json({ message: 'Profile creation failed' });
        }

        // Create wallet
        const { error: walletError } = await supabaseAdmin
            .from('wallets')
            .insert({ user_id: userId });

        if (walletError) {
            console.error('Wallet creation error:', walletError);
        }

        // Sign in to get token
        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
            email,
            password
        });

        if (signInError) {
            return res.status(500).json({ message: 'User created but login failed' });
        }

        res.status(201).json({
            token: signInData.session.access_token,
            needsPayment: !isAdmin,
            user: {
                id: userId,
                email,
                referralCode: userRefCode
            }
        });

    } catch (err) {
        console.error('Signup error:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

app.post('/auth/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password
        });

        if (error) {
            return res.status(400).json({ message: 'Invalid credentials' });
        }

        // Check if user is paid
        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('is_paid')
            .eq('id', data.user.id)
            .single();

        res.json({
            token: data.session.access_token,
            needsPayment: !profile?.is_paid
        });

    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ message: 'Login failed' });
    }
});

app.post('/auth/update-password', authenticateToken, async (req, res) => {
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    try {
        const { error } = await supabaseAdmin.auth.admin.updateUserById(
            req.user.id,
            { password: newPassword }
        );

        if (error) {
            return res.status(500).json({ message: 'Password update failed' });
        }

        res.json({ success: true, message: 'Password updated successfully' });

    } catch (err) {
        console.error('Password update error:', err);
        res.status(500).json({ message: 'Update failed' });
    }
});

// ===================================
// WALLET / DASHBOARD ENDPOINTS
// ===================================

app.get('/dashboard/data', authenticateToken, async (req, res) => {
    const userId = req.user.id;

    try {
        // Get user profile
        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('is_paid, referral_code, is_admin')
            .eq('id', userId)
            .single();

        if (!profile) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Get wallet
        const { data: wallet } = await supabaseAdmin
            .from('wallets')
            .select('balance_units')
            .eq('user_id', userId)
            .single();

        // Get referrals
        const { data: referrals } = await supabaseAdmin
            .from('referrals')
            .select('*')
            .eq('referrer_id', userId);

        // Get Pending Task Earnings
        const { data: pendingSubmissions } = await supabaseAdmin
            .from('task_submissions')
            .select(`
                status,
                admin_tasks ( reward_kes )
            `)
            .eq('user_id', userId)
            .eq('status', 'pending');

        const pendingTaskEarnings = pendingSubmissions?.reduce((sum, sub) => {
            return sum + (sub.admin_tasks?.reward_kes || 0);
        }, 0) || 0;

        res.json({
            user: {
                email: req.user.email,
                referralCode: profile.referral_code,
                isPaid: !!profile.is_paid,
                isAdmin: !!profile.is_admin
            },
            wallet: {
                balanceKES: (wallet?.balance_units || 0) / PAYSTACK_UNIT,
                pendingCombined: pendingTaskEarnings // Just pending tasks for now
            },
            referrals: referrals || []
        });

    } catch (err) {
        console.error('Dashboard data error:', err);
        res.status(500).json({ message: 'Failed to fetch data' });
    }
});

// ===================================
// PAYMENT & VERIFICATION
// ===================================

app.post('/pay/initiate', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    const reference = 'REF_' + Date.now() + '_' + userId;
    const amountUnits = SIGNUP_FEE_UNITS;

    try {
        const { error } = await supabaseAdmin
            .from('transactions')
            .insert({
                reference,
                user_id: userId,
                amount_units: amountUnits,
                currency: 'KES',
                status: 'pending',
                metadata: { type: 'signup' }
            });

        if (error) {
            console.error('Transaction creation error:', error);
            return res.status(500).json({ message: 'Transaction creation failed' });
        }

        res.json({
            reference,
            amount: amountUnits,
            key: process.env.PAYSTACK_PUBLIC_KEY || 'pk_test_e61df53001707bcf5afe0fbfa20d361c209311f1'
        });

    } catch (err) {
        console.error('Payment initiate error:', err);
        res.status(500).json({ message: 'Failed to initiate payment' });
    }
});

app.post('/pay/mark-paid', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    console.log(`[MARK-PAID] Attempting to mark user ${userId} as paid`);

    try {
        // Check if user is already paid
        const { data: existingProfile } = await supabaseAdmin
            .from('profiles')
            .select('is_paid, referred_by')
            .eq('id', userId)
            .single();

        if (existingProfile?.is_paid) {
            console.log(`[MARK-PAID] User ${userId} already paid, skipping`);
            return res.json({ success: true, userId, message: 'Already paid' });
        }

        // Mark user as paid
        const { error } = await supabaseAdmin
            .from('profiles')
            .update({ is_paid: true })
            .eq('id', userId);

        if (error) {
            console.error('[MARK-PAID] Database error:', error);
            return res.status(500).json({ message: 'Failed to update' });
        }

        console.log(`[MARK-PAID] Successfully updated user ${userId}`);

        // Process referral bonus if user was referred
        if (existingProfile?.referred_by) {
            console.log(`[MARK-PAID] Processing referral bonus for referrer: ${existingProfile.referred_by}`);

            // Check if referral bonus already paid
            const { data: existingRef } = await supabaseAdmin
                .from('referrals')
                .select('id')
                .eq('referred_user_id', userId)
                .single();

            if (!existingRef) {
                const reward = REFERRAL_REWARD_UNITS;

                // Get referrer's current wallet balance
                const { data: referrerWallet } = await supabaseAdmin
                    .from('wallets')
                    .select('balance_units')
                    .eq('user_id', existingProfile.referred_by)
                    .single();

                // Credit referrer wallet
                await supabaseAdmin
                    .from('wallets')
                    .update({
                        balance_units: (referrerWallet?.balance_units || 0) + reward
                    })
                    .eq('user_id', existingProfile.referred_by);

                console.log(`[MARK-PAID] Credited ${reward} units to referrer ${existingProfile.referred_by}`);

                // Record referral transaction
                const refTxRef = 'REF_BONUS_' + userId + '_' + Date.now();
                const { data: refTx } = await supabaseAdmin
                    .from('transactions')
                    .insert({
                        reference: refTxRef,
                        user_id: existingProfile.referred_by,
                        amount_units: reward,
                        status: 'success',
                        metadata: { type: 'referral_bonus', source: userId }
                    })
                    .select()
                    .single();

                // Add referral record
                await supabaseAdmin
                    .from('referrals')
                    .insert({
                        referrer_id: existingProfile.referred_by,
                        referred_user_id: userId,
                        reward_units: reward,
                        status: 'paid',
                        awarded_tx_id: refTx?.id
                    });

                console.log(`[MARK-PAID] Referral bonus processed successfully`);
            } else {
                console.log(`[MARK-PAID] Referral bonus already paid for user ${userId}`);
            }
        }

        res.json({ success: true, userId });

    } catch (err) {
        console.error('[MARK-PAID] Error:', err);
        res.status(500).json({ message: 'Update failed' });
    }
});

app.get('/verify/:reference', async (req, res) => {
    const reference = req.params.reference;

    if (!reference) {
        return res.status(400).json({ verified: false, message: 'No reference' });
    }

    try {
        const resp = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
            headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }
        });

        const d = resp.data;
        if (d && d.status && d.data && d.data.status === 'success') {
            await processSuccessfulPayment(d.data);
            return res.json({ verified: true, data: d.data });
        } else {
            return res.json({ verified: false, message: 'Payment not successful' });
        }
    } catch (err) {
        console.error('Verify error', err.message);
        return res.status(500).json({ verified: false, message: 'Verification error' });
    }
});

app.post('/webhook/paystack', async (req, res) => {
    const signature = req.headers['x-paystack-signature'];
    const secret = PAYSTACK_SECRET;
    const payload = JSON.stringify(req.body);

    const hmac = crypto.createHmac('sha512', secret).update(payload).digest('hex');
    if (hmac !== signature) {
        return res.status(400).send('Invalid signature');
    }

    const event = req.body;
    if (event.event === 'charge.success') {
        await processSuccessfulPayment(event.data);
    }
    res.status(200).send('OK');
});

// ===================================
// TASK COMPLETION
// ===================================

app.post('/tasks/complete', authenticateToken, async (req, res) => {
    const { taskType, reward } = req.body;
    const userId = req.user.id;
    const rewardAmount = parseInt(reward) * PAYSTACK_UNIT;

    if (!rewardAmount || rewardAmount <= 0) {
        return res.status(400).json({ message: 'Invalid reward' });
    }

    try {
        // Insert task log
        const { error: taskError } = await supabaseAdmin
            .from('task_logs')
            .insert({
                user_id: userId,
                task_type: taskType,
                amount: rewardAmount
            });

        if (taskError) {
            console.error('Task log error:', taskError);
            return res.status(500).json({ message: 'Failed to log task' });
        }

        // Update wallet
        const { data: wallet, error: walletError } = await supabaseAdmin.rpc(
            'increment_wallet_balance',
            { user_uuid: userId, amount: rewardAmount }
        );

        // If RPC doesn't exist, do it manually
        if (walletError) {
            const { error: updateError } = await supabaseAdmin
                .from('wallets')
                .update({ balance_units: supabaseAdmin.raw(`balance_units + ${rewardAmount}`) })
                .eq('user_id', userId);

            if (updateError) {
                console.error('Wallet update error:', updateError);
                return res.status(500).json({ message: 'Failed to update wallet' });
            }
        }

        // Get new balance
        const { data: updatedWallet } = await supabaseAdmin
            .from('wallets')
            .select('balance_units')
            .eq('user_id', userId)
            .single();

        res.json({
            success: true,
            newBalance: (updatedWallet?.balance_units || 0) / PAYSTACK_UNIT
        });

    } catch (err) {
        console.error('Task completion error:', err);
        res.status(500).json({ message: 'Failed to complete task' });
    }
});

// ===================================
// WITHDRAWAL
// ===================================

app.post('/withdraw', authenticateToken, async (req, res) => {
    const { amount, phone } = req.body;
    const userId = req.user.id;
    const withdrawAmount = parseInt(amount) * PAYSTACK_UNIT;

    if (!withdrawAmount || withdrawAmount < (150 * PAYSTACK_UNIT)) {
        return res.status(400).json({ message: 'Minimum 150 KES' });
    }

    try {
        // Check balance
        const { data: wallet } = await supabaseAdmin
            .from('wallets')
            .select('balance_units')
            .eq('user_id', userId)
            .single();

        if (!wallet || wallet.balance_units < withdrawAmount) {
            return res.status(400).json({ message: 'Insufficient balance' });
        }

        // Deduct from wallet
        const { error: deductError } = await supabaseAdmin
            .from('wallets')
            .update({ balance_units: wallet.balance_units - withdrawAmount })
            .eq('user_id', userId);

        if (deductError) {
            console.error('Deduct error:', deductError);
            return res.status(500).json({ message: 'Failed to deduct balance' });
        }

        // Create withdrawal request
        const { error: withdrawError } = await supabaseAdmin
            .from('withdrawals')
            .insert({
                user_id: userId,
                amount: withdrawAmount / PAYSTACK_UNIT,
                phone
            });

        if (withdrawError) {
            // Refund if withdrawal creation failed
            await supabaseAdmin
                .from('wallets')
                .update({ balance_units: wallet.balance_units })
                .eq('user_id', userId);

            console.error('Withdrawal error:', withdrawError);
            return res.status(500).json({ message: 'Failed to create withdrawal' });
        }

        res.json({ success: true });

    } catch (err) {
        console.error('Withdrawal error:', err);
        res.status(500).json({ message: 'Withdrawal failed' });
    }
});

// ===================================
// COURSE SYSTEM ENDPOINTS
// ===================================

app.get('/courses', async (req, res) => {
    try {
        const { data: courses, error } = await supabase
            .from('courses')
            .select(`
                id, title, description, thumbnail_url, price, duration_hours,
                lessons(count)
            `)
            .eq('is_published', true)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Courses fetch error:', error);
            return res.status(500).json({ error: error.message });
        }

        const formatted = courses.map(c => ({
            ...c,
            priceKES: c.price / 100,
            lesson_count: c.lessons?.[0]?.count || 0
        }));

        res.json(formatted);

    } catch (err) {
        console.error('Courses error:', err);
        res.status(500).json({ error: 'Failed to fetch courses' });
    }
});

app.get('/courses/:id', async (req, res) => {
    const courseId = req.params.id;

    try {
        const { data: course, error: courseError } = await supabase
            .from('courses')
            .select('*')
            .eq('id', courseId)
            .eq('is_published', true)
            .single();

        if (courseError || !course) {
            return res.status(404).json({ message: 'Course not found' });
        }

        const { data: lessons } = await supabase
            .from('lessons')
            .select('id, title, duration_minutes, order_index')
            .eq('course_id', courseId)
            .order('order_index', { ascending: true });

        res.json({
            ...course,
            priceKES: course.price / 100,
            lessons: lessons || []
        });

    } catch (err) {
        console.error('Course detail error:', err);
        res.status(500).json({ error: 'Failed to fetch course' });
    }
});

app.get('/courses/:id/access', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    const courseId = req.params.id;

    try {
        const hasAccess = await userOwnsCourse(userId, courseId);
        res.json({ hasAccess });

    } catch (err) {
        console.error('Access check error:', err);
        res.status(500).json({ error: 'Failed to check access' });
    }
});

app.get('/my-courses', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    console.log('Fetching courses for user:', userId);

    try {
        const { data: purchases, error } = await supabaseAdmin
            .from('course_purchases')
            .select(`
                purchased_at,
                course_id,
                courses (
                    id, title, description, thumbnail_url, price, duration_hours
                )
            `)
            .eq('user_id', userId)
            .order('purchased_at', { ascending: false });

        console.log('Purchases query result:', { purchases, error });

        if (error) {
            console.error('My courses error:', error);
            return res.status(500).json({ error: error.message });
        }

        if (!purchases || purchases.length === 0) {
            console.log('No purchases found for user');
            return res.json([]);
        }

        const coursesWithProgress = await Promise.all(
            purchases.map(async (p) => {
                const course = p.courses;
                if (!course) return null;

                // Get total lessons for this course
                const { data: lessons } = await supabaseAdmin
                    .from('lessons')
                    .select('id')
                    .eq('course_id', course.id);

                const totalLessons = lessons?.length || 0;
                const lessonIds = lessons?.map(l => l.id) || [];

                // Get completed lessons for this user
                let completedLessons = 0;
                if (lessonIds.length > 0) {
                    const { count } = await supabaseAdmin
                        .from('lesson_progress')
                        .select('*', { count: 'exact', head: true })
                        .eq('user_id', userId)
                        .eq('completed', true)
                        .in('lesson_id', lessonIds);
                    completedLessons = count || 0;
                }

                return {
                    ...course,
                    priceKES: course.price / 100,
                    purchased_at: p.purchased_at,
                    total_lessons: totalLessons,
                    completed_lessons: completedLessons,
                    progress: totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0
                };
            })
        );

        // Filter out null entries
        res.json(coursesWithProgress.filter(c => c !== null));

    } catch (err) {
        console.error('My courses error:', err);
        res.status(500).json({ error: 'Failed to fetch courses' });
    }
});

// Get user's owned course IDs (lightweight endpoint for lock/unlock badges)
app.get('/courses/owned', authenticateToken, async (req, res) => {
    const userId = req.user.id;

    try {
        // Check if admin
        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('is_admin')
            .eq('id', userId)
            .single();

        if (profile?.is_admin) {
            // Admin owns everything
            const { data: allCourses } = await supabaseAdmin
                .from('courses')
                .select('id');

            return res.json(allCourses.map(c => ({ course_id: c.id })));
        }

        const { data: purchases, error } = await supabaseAdmin
            .from('course_purchases')
            .select('course_id')
            .eq('user_id', userId);

        if (error) {
            console.error('Owned courses error:', error);
            return res.status(500).json({ error: error.message });
        }

        res.json(purchases || []);
    } catch (err) {
        console.error('Owned courses error:', err);
        res.status(500).json({ error: 'Failed to fetch owned courses' });
    }
});

// Get user's course orders (pending purchases)
app.get('/my-orders', authenticateToken, async (req, res) => {
    const userId = req.user.id;

    try {
        const { data: orders, error } = await supabaseAdmin
            .from('course_orders')
            .select(`
                id, course_id, amount_paid, transaction_ref, status, created_at,
                courses ( title )
            `)
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('My orders error:', error);
            return res.status(500).json({ error: error.message });
        }

        const formatted = (orders || []).map(o => ({
            ...o,
            courseTitle: o.courses?.title || 'Course'
        }));

        res.json(formatted);
    } catch (err) {
        console.error('My orders error:', err);
        res.status(500).json({ error: 'Failed to fetch orders' });
    }
});

app.post('/courses/:id/purchase', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    const courseId = req.params.id;

    try {
        // Check if already purchased
        const { data: existing } = await supabaseAdmin
            .from('course_purchases')
            .select('id')
            .eq('user_id', userId)
            .eq('course_id', courseId)
            .single();

        if (existing) {
            return res.status(400).json({ message: 'Course already purchased' });
        }

        // Get course price
        const { data: course, error: courseError } = await supabase
            .from('courses')
            .select('price, title')
            .eq('id', courseId)
            .eq('is_published', true)
            .single();

        if (courseError || !course) {
            return res.status(404).json({ message: 'Course not found' });
        }

        const reference = 'COURSE_' + courseId + '_' + Date.now() + '_' + userId;

        const { error: txError } = await supabaseAdmin
            .from('transactions')
            .insert({
                reference,
                user_id: userId,
                amount_units: course.price,
                currency: 'KES',
                status: 'pending',
                metadata: { type: 'course_purchase', course_id: courseId }
            });

        if (txError) {
            console.error('Transaction error:', txError);
            return res.status(500).json({ message: 'Transaction creation failed' });
        }

        res.json({
            reference,
            amount: course.price,
            key: process.env.PAYSTACK_PUBLIC_KEY || 'pk_test_e61df53001707bcf5afe0fbfa20d361c209311f1',
            courseTitle: course.title
        });

    } catch (err) {
        console.error('Course purchase error:', err);
        res.status(500).json({ message: 'Purchase failed' });
    }
});

// Create pending course order after Paystack payment
app.post('/courses/:id/order', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    const courseId = req.params.id;
    const { reference, paystackRef, amount } = req.body;

    console.log('Creating course order:', { userId, courseId, reference, paystackRef, amount });

    try {
        // Check if order already exists
        const { data: existing } = await supabaseAdmin
            .from('course_orders')
            .select('id, status')
            .eq('user_id', userId)
            .eq('course_id', courseId)
            .single();

        if (existing) {
            console.log('Order already exists:', existing);
            return res.json({ success: true, message: 'Order already submitted', orderId: existing.id, status: existing.status });
        }

        // Check if already purchased
        const { data: purchased } = await supabaseAdmin
            .from('course_purchases')
            .select('id')
            .eq('user_id', userId)
            .eq('course_id', courseId)
            .single();

        if (purchased) {
            return res.json({ success: true, message: 'Course already owned' });
        }

        // Create pending order
        const { data: order, error } = await supabaseAdmin
            .from('course_orders')
            .insert({
                user_id: userId,
                course_id: parseInt(courseId),
                amount_paid: amount || 0,
                transaction_ref: paystackRef || reference,
                status: 'pending'
            })
            .select()
            .single();

        if (error) {
            console.error('Order creation error:', error);
            return res.status(500).json({ success: false, message: error.message });
        }

        console.log('Order created successfully:', order);
        res.json({ success: true, message: 'Order submitted for verification', orderId: order.id });

    } catch (err) {
        console.error('Order error:', err);
        res.status(500).json({ success: false, message: 'Order failed' });
    }
});

// Direct unlock after Paystack payment success
app.post('/courses/:id/unlock', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    const courseId = req.params.id;
    const { reference, paystackRef, amount } = req.body;

    console.log('Unlock request:', { userId, courseId, reference, paystackRef, amount });

    try {
        // Check if already purchased
        const { data: existing } = await supabaseAdmin
            .from('course_purchases')
            .select('id')
            .eq('user_id', userId)
            .eq('course_id', courseId)
            .single();

        if (existing) {
            console.log('Course already purchased');
            return res.json({ success: true, message: 'Course already owned' });
        }

        // Insert purchase record directly
        const { data: purchase, error: purchaseError } = await supabaseAdmin
            .from('course_purchases')
            .insert({
                user_id: userId,
                course_id: parseInt(courseId),
                amount_paid: amount || 0,
                transaction_ref: paystackRef || reference
            })
            .select()
            .single();

        if (purchaseError) {
            console.error('Unlock purchase error:', purchaseError);
            return res.status(500).json({ success: false, message: purchaseError.message });
        }

        console.log('Course unlocked successfully:', purchase);

        // Update any pending transaction
        if (reference) {
            await supabaseAdmin
                .from('transactions')
                .update({ status: 'success' })
                .eq('reference', reference);
        }

        res.json({ success: true, message: 'Course unlocked!', purchaseId: purchase.id });

    } catch (err) {
        console.error('Unlock error:', err);
        res.status(500).json({ success: false, message: 'Unlock failed' });
    }
});

app.post('/courses/verify-payment', authenticateToken, async (req, res) => {
    const { reference } = req.body;
    const userId = req.user.id;

    try {
        const resp = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
            headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }
        });

        const data = resp.data;
        if (data && data.status && data.data && data.data.status === 'success') {
            // Get transaction metadata
            const { data: tx, error: txError } = await supabaseAdmin
                .from('transactions')
                .select('metadata')
                .eq('reference', reference)
                .single();

            if (txError || !tx) {
                return res.status(404).json({ message: 'Transaction not found' });
            }

            const meta = tx.metadata;
            if (meta.type !== 'course_purchase') {
                return res.status(400).json({ message: 'Invalid transaction type' });
            }

            const courseId = meta.course_id;

            // Grant access
            const { error: purchaseError } = await supabaseAdmin
                .from('course_purchases')
                .insert({
                    user_id: userId,
                    course_id: courseId,
                    amount_paid: data.data.amount,
                    transaction_ref: reference
                });

            if (purchaseError && purchaseError.code !== '23505') { // 23505 = duplicate
                console.error('Purchase error:', purchaseError);
                return res.status(500).json({ message: 'Failed to grant access' });
            }

            // Update transaction status
            await supabaseAdmin
                .from('transactions')
                .update({ status: 'success' })
                .eq('reference', reference);

            res.json({ success: true, message: 'Course purchased successfully!', courseId });
        } else {
            res.json({ success: false, message: 'Payment verification failed' });
        }
    } catch (err) {
        console.error('Course payment verification error:', err.message);
        res.status(500).json({ success: false, message: 'Verification error' });
    }
});

// Admin: Grant course access manually (for testing)
app.post('/admin/grant-course-access', authenticateToken, requireAdmin, async (req, res) => {
    const { userId, courseId } = req.body;

    if (!userId || !courseId) {
        return res.status(400).json({ message: 'userId and courseId required' });
    }

    try {
        const { error } = await supabaseAdmin
            .from('course_purchases')
            .insert({
                user_id: userId,
                course_id: parseInt(courseId),
                amount_paid: 0,
                transaction_ref: 'ADMIN_GRANT_' + Date.now()
            });

        if (error && error.code !== '23505') {
            console.error('Grant error:', error);
            return res.status(500).json({ error: error.message });
        }

        res.json({ success: true, message: 'Course access granted' });
    } catch (err) {
        console.error('Grant course error:', err);
        res.status(500).json({ error: 'Failed to grant access' });
    }
});

// Get user's owned/purchased courses
app.get('/courses/owned', authenticateToken, async (req, res) => {
    const userId = req.user.id;

    try {
        const { data, error } = await supabaseAdmin
            .from('course_purchases')
            .select('course_id')
            .eq('user_id', userId);

        if (error) {
            console.error('Fetch owned courses error:', error);
            return res.status(500).json({ error: error.message });
        }

        res.json(data || []);
    } catch (err) {
        console.error('Owned courses error:', err);
        res.status(500).json({ error: 'Failed to fetch owned courses' });
    }
});

app.post('/lessons/:id/progress', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    const lessonId = req.params.id;
    const { completed, watched_seconds } = req.body;

    try {
        // Check if user owns the course
        const { data: lesson } = await supabase
            .from('lessons')
            .select('course_id')
            .eq('id', lessonId)
            .single();

        if (!lesson) {
            return res.status(404).json({ message: 'Lesson not found' });
        }

        const hasAccess = await userOwnsCourse(userId, lesson.course_id);
        if (!hasAccess) {
            return res.status(403).json({ message: 'Access denied' });
        }

        // Upsert progress
        const { error } = await supabaseAdmin
            .from('lesson_progress')
            .upsert({
                user_id: userId,
                lesson_id: lessonId,
                completed: completed ? true : false,
                watched_seconds: watched_seconds || 0,
                updated_at: new Date().toISOString()
            }, {
                onConflict: 'user_id,lesson_id'
            });

        if (error) {
            console.error('Progress update error:', error);
            return res.status(500).json({ error: error.message });
        }

        res.json({ success: true });

    } catch (err) {
        console.error('Lesson progress error:', err);
        res.status(500).json({ error: 'Failed to update progress' });
    }
});

// ===================================
// CHAPTER ENDPOINTS
// ===================================

// Get chapters for a course
app.get('/courses/:id/chapters', async (req, res) => {
    const courseId = req.params.id;

    try {
        const { data: chapters, error } = await supabaseAdmin
            .from('chapters')
            .select('id, title, category, order_num')
            .eq('course_id', courseId)
            .order('order_num', { ascending: true });

        if (error) {
            console.error('Chapters fetch error:', error);
            return res.status(500).json({ error: error.message });
        }

        res.json(chapters || []);
    } catch (err) {
        console.error('Chapters error:', err);
        res.status(500).json({ error: 'Failed to fetch chapters' });
    }
});

// Get single chapter content (requires course access)
app.get('/chapters/:id', authenticateToken, async (req, res) => {
    const chapterId = req.params.id;
    const userId = req.user.id;

    try {
        // Get chapter with course info
        const { data: chapter, error } = await supabaseAdmin
            .from('chapters')
            .select('*, courses!inner(id, title)')
            .eq('id', chapterId)
            .single();

        if (error || !chapter) {
            return res.status(404).json({ error: 'Chapter not found' });
        }

        // Check course access (handles admins and purchases)
        const hasAccess = await userOwnsCourse(userId, chapter.course_id);

        if (!hasAccess) {
            return res.status(403).json({ error: 'Purchase required' });
        }

        res.json(chapter);
    } catch (err) {
        console.error('Chapter content error:', err);
        res.status(500).json({ error: 'Failed to fetch chapter' });
    }
});

// Update chapter progress
app.post('/chapters/:id/progress', authenticateToken, async (req, res) => {
    const chapterId = req.params.id;
    const userId = req.user.id;

    try {
        // Get chapter's course_id
        const { data: chapter } = await supabaseAdmin
            .from('chapters')
            .select('course_id')
            .eq('id', chapterId)
            .single();

        if (!chapter) {
            return res.status(404).json({ error: 'Chapter not found' });
        }

        // Upsert progress
        const { error } = await supabaseAdmin
            .from('chapter_progress')
            .upsert({
                user_id: userId,
                course_id: chapter.course_id,
                last_chapter_id: parseInt(chapterId),
                updated_at: new Date().toISOString()
            }, {
                onConflict: 'user_id,course_id'
            });

        if (error) {
            console.error('Progress error:', error);
            return res.status(500).json({ error: error.message });
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Chapter progress error:', err);
        res.status(500).json({ error: 'Failed to update progress' });
    }
});

// Get user's progress for a course
app.get('/courses/:id/progress', authenticateToken, async (req, res) => {
    const courseId = req.params.id;
    const userId = req.user.id;

    try {
        const { data: progress } = await supabaseAdmin
            .from('chapter_progress')
            .select('last_chapter_id, completed_chapters')
            .eq('user_id', userId)
            .eq('course_id', courseId)
            .single();

        res.json(progress || { last_chapter_id: null, completed_chapters: [] });
    } catch (err) {
        console.error('Progress fetch error:', err);
        res.status(500).json({ error: 'Failed to fetch progress' });
    }
});

// ===================================
// ADMIN CHAPTER ENDPOINTS
// ===================================

// Add chapter to course
app.post('/admin/courses/:id/chapters', authenticateToken, requireAdmin, async (req, res) => {
    const courseId = req.params.id;
    const { title, category, content_html, order_num } = req.body;

    if (!title) {
        return res.status(400).json({ error: 'Title required' });
    }

    try {
        // Get max order if not provided
        let orderNum = order_num;
        if (orderNum === undefined) {
            const { data: maxChapter } = await supabaseAdmin
                .from('chapters')
                .select('order_num')
                .eq('course_id', courseId)
                .order('order_num', { ascending: false })
                .limit(1)
                .single();
            orderNum = (maxChapter?.order_num || 0) + 1;
        }

        const { data, error } = await supabaseAdmin
            .from('chapters')
            .insert({
                course_id: parseInt(courseId),
                title,
                category: category || null,
                content_html: content_html || '',
                order_num: orderNum
            })
            .select()
            .single();

        if (error) {
            console.error('Chapter create error:', error);
            return res.status(500).json({ error: error.message });
        }

        res.json({ success: true, chapter: data });
    } catch (err) {
        console.error('Admin chapter create error:', err);
        res.status(500).json({ error: 'Failed to create chapter' });
    }
});

// Update chapter
app.put('/admin/chapters/:id', authenticateToken, requireAdmin, async (req, res) => {
    const chapterId = req.params.id;
    const { title, category, content_html, order_num } = req.body;

    try {
        const updates = {};
        if (title !== undefined) updates.title = title;
        if (category !== undefined) updates.category = category;
        if (content_html !== undefined) updates.content_html = content_html;
        if (order_num !== undefined) updates.order_num = order_num;
        updates.updated_at = new Date().toISOString();

        const { error } = await supabaseAdmin
            .from('chapters')
            .update(updates)
            .eq('id', chapterId);

        if (error) {
            console.error('Chapter update error:', error);
            return res.status(500).json({ error: error.message });
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Admin chapter update error:', err);
        res.status(500).json({ error: 'Failed to update chapter' });
    }
});

// Delete chapter
app.delete('/admin/chapters/:id', authenticateToken, requireAdmin, async (req, res) => {
    const chapterId = req.params.id;

    try {
        const { error } = await supabaseAdmin
            .from('chapters')
            .delete()
            .eq('id', chapterId);

        if (error) {
            console.error('Chapter delete error:', error);
            return res.status(500).json({ error: error.message });
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Admin chapter delete error:', err);
        res.status(500).json({ error: 'Failed to delete chapter' });
    }
});

// Reorder chapters
app.put('/admin/courses/:id/chapters/reorder', authenticateToken, requireAdmin, async (req, res) => {
    const courseId = req.params.id;
    const { order } = req.body; // Array of { id, order_num }

    if (!Array.isArray(order)) {
        return res.status(400).json({ error: 'Order array required' });
    }

    try {
        for (const item of order) {
            await supabaseAdmin
                .from('chapters')
                .update({ order_num: item.order_num })
                .eq('id', item.id)
                .eq('course_id', courseId);
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Chapter reorder error:', err);
        res.status(500).json({ error: 'Failed to reorder' });
    }
});

// ===================================
// ADMIN COURSE RESOURCES (Tools & Videos)
// ===================================

// Get resources for a course (Public for now, or authenticated)
app.get('/courses/:id/resources', async (req, res) => {
    const courseId = req.params.id;
    try {
        const { data, error } = await supabaseAdmin
            .from('course_resources')
            .select('*')
            .eq('course_id', courseId)
            .order('order_index', { ascending: true });

        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        console.error('Fetch resources error:', err);
        res.status(500).json({ error: 'Failed to fetch resources' });
    }
});

// Add resource
app.post('/admin/resources', authenticateToken, requireAdmin, async (req, res) => {
    console.log('Adding resource:', req.body); // DEBUG LOG
    const { course_id, type, title, url } = req.body;

    if (!course_id || !title || !url || !type) {
        console.log('Missing fields in resource add');
        return res.status(400).json({ message: 'Missing fields' });
    }

    try {
        // First get the max order_index for this course
        const { data: existing } = await supabaseAdmin
            .from('course_resources')
            .select('order_index')
            .eq('course_id', parseInt(course_id))
            .order('order_index', { ascending: false })
            .limit(1);

        const nextOrder = (existing && existing.length > 0) ? existing[0].order_index + 1 : 0;

        const { data, error } = await supabaseAdmin
            .from('course_resources')
            .insert({
                course_id: parseInt(course_id),
                type,
                title,
                url,
                order_index: nextOrder
            })
            .select()
            .single();

        if (error) {
            console.error('Supabase Insert Error:', error); // DEBUG LOG
            throw error;
        }
        res.json({ success: true, resource: data });

    } catch (err) {
        console.error('Add resource error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Delete resource
app.delete('/admin/resources/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { error } = await supabaseAdmin
            .from('course_resources')
            .delete()
            .eq('id', req.params.id);

        if (error) throw error;
        res.json({ success: true });

    } catch (err) {
        console.error('Delete resource error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/admin/courses/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { error } = await supabaseAdmin
            .from('courses')
            .delete()
            .eq('id', req.params.id);

        if (error) {
            console.error('Course delete error:', error);
            return res.status(500).json({ error: error.message });
        }

        res.json({ success: true });

    } catch (err) {
        console.error('Admin course delete error:', err);
        res.status(500).json({ error: 'Failed to delete course' });
    }
});

app.put('/admin/courses/:id/publish', authenticateToken, requireAdmin, async (req, res) => {
    const { is_published } = req.body;

    try {
        const { error } = await supabaseAdmin
            .from('courses')
            .update({ is_published: is_published ? true : false })
            .eq('id', req.params.id);

        if (error) {
            console.error('Publish error:', error);
            return res.status(500).json({ error: error.message });
        }

        res.json({ success: true });

    } catch (err) {
        console.error('Admin publish error:', err);
        res.status(500).json({ error: 'Failed to publish course' });
    }
});

app.post('/admin/courses/:id/lessons', authenticateToken, requireAdmin, async (req, res) => {
    const courseId = req.params.id;
    const { title, video_url, order_index, duration_minutes } = req.body;

    if (!title) {
        return res.status(400).json({ message: 'Lesson title required' });
    }

    try {
        const { data, error } = await supabaseAdmin
            .from('lessons')
            .insert({
                course_id: courseId,
                title,
                video_url: video_url || '',
                order_index: order_index || 0,
                duration_minutes: duration_minutes || 0
            })
            .select()
            .single();

        if (error) {
            console.error('Lesson creation error:', error);
            return res.status(500).json({ error: error.message });
        }

        res.json({ success: true, lessonId: data.id });

    } catch (err) {
        console.error('Admin lesson create error:', err);
        res.status(500).json({ error: 'Failed to create lesson' });
    }
});

app.put('/admin/lessons/:id', authenticateToken, requireAdmin, async (req, res) => {
    const { title, video_url, order_index, duration_minutes } = req.body;
    const lessonId = req.params.id;

    try {
        const updates = {};
        if (title) updates.title = title;
        if (video_url) updates.video_url = video_url;
        if (order_index !== undefined) updates.order_index = order_index;
        if (duration_minutes !== undefined) updates.duration_minutes = duration_minutes;

        const { error } = await supabaseAdmin
            .from('lessons')
            .update(updates)
            .eq('id', lessonId);

        if (error) {
            console.error('Lesson update error:', error);
            return res.status(500).json({ error: error.message });
        }

        res.json({ success: true });

    } catch (err) {
        console.error('Admin lesson update error:', err);
        res.status(500).json({ error: 'Failed to update lesson' });
    }
});

app.delete('/admin/lessons/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { error } = await supabaseAdmin
            .from('lessons')
            .delete()
            .eq('id', req.params.id);

        if (error) {
            console.error('Lesson delete error:', error);
            return res.status(500).json({ error: error.message });
        }

        res.json({ success: true });

    } catch (err) {
        console.error('Admin lesson delete error:', err);
        res.status(500).json({ error: 'Failed to delete lesson' });
    }
});

app.get('/admin/courses', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { data: courses, error } = await supabaseAdmin
            .from('courses')
            .select(`
                *,
                lessons(count),
                course_purchases(count)
            `)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Admin courses error:', error);
            return res.status(500).json({ error: error.message });
        }

        const formatted = courses.map(c => ({
            ...c,
            priceKES: c.price / 100,
            lesson_count: c.lessons?.[0]?.count || 0,
            purchase_count: c.course_purchases?.[0]?.count || 0
        }));

        res.json(formatted);

    } catch (err) {
        console.error('Admin courses error:', err);
        res.status(500).json({ error: 'Failed to fetch courses' });
    }
});

// Admin: Create course
app.post('/admin/courses', authenticateToken, requireAdmin, async (req, res) => {
    const { title, short_description, description, thumbnail_url, price, category } = req.body;

    if (!title || !price) {
        return res.status(400).json({ message: 'Title and price are required' });
    }

    try {
        const { data, error } = await supabaseAdmin
            .from('courses')
            .insert({
                title,
                description: description || '',
                short_description: short_description || '',
                thumbnail_url: thumbnail_url || null,
                price: parseInt(price) * 100, // Store in cents
                is_published: false,
                created_by: req.user.id,
                category: category || 'other'
            })
            .select()
            .single();

        if (error) {
            console.error('Course creation error:', error);
            return res.status(500).json({ error: error.message });
        }

        res.json({ success: true, course: data });

    } catch (err) {
        console.error('Admin course create error:', err);
        res.status(500).json({ error: 'Failed to create course' });
    }
});

// Admin: Update course
app.put('/admin/courses/:id', authenticateToken, requireAdmin, async (req, res) => {
    const courseId = req.params.id;
    const { title, short_description, description, thumbnail_url, price, category } = req.body;

    try {
        const updates = {};
        if (title !== undefined) updates.title = title;
        if (description !== undefined) updates.description = description;
        if (short_description !== undefined) updates.short_description = short_description;
        if (thumbnail_url !== undefined) updates.thumbnail_url = thumbnail_url;
        if (price !== undefined) updates.price = parseInt(price) * 100; // Store in cents
        if (category !== undefined) updates.category = category;
        updates.updated_at = new Date().toISOString();

        const { error } = await supabaseAdmin
            .from('courses')
            .update(updates)
            .eq('id', courseId);

        if (error) {
            console.error('Course update error:', error);
            return res.status(500).json({ error: error.message });
        }

        res.json({ success: true });

    } catch (err) {
        console.error('Admin course update error:', err);
        res.status(500).json({ error: 'Failed to update course' });
    }
});

app.get('/admin/data', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { data: users } = await supabaseAdmin
            .from('profiles')
            .select('id, email, is_paid, referral_code')
            .order('created_at', { ascending: false });

        const { data: withdrawals } = await supabaseAdmin
            .from('withdrawals')
            .select(`
                id, amount, phone, status, created_at,
                profiles(email)
            `)
            .order('created_at', { ascending: false });

        const formattedWithdrawals = withdrawals?.map(w => ({
            ...w,
            email: w.profiles?.email
        })) || [];

        res.json({ users: users || [], withdrawals: formattedWithdrawals });

    } catch (err) {
        console.error('Admin data error:', err);
        res.status(500).json({ error: 'Failed to fetch admin data' });
    }
});

app.post('/admin/withdraw/:id/action', authenticateToken, requireAdmin, async (req, res) => {
    const { action } = req.body;
    const id = req.params.id;
    const status = action === 'approve' ? 'approved' : 'rejected';

    try {
        const { error } = await supabaseAdmin
            .from('withdrawals')
            .update({ status, processed_at: new Date().toISOString() })
            .eq('id', id);

        if (error) {
            console.error('Withdrawal action error:', error);
            return res.status(500).json({ error: error.message });
        }

        res.json({ success: true });

    } catch (err) {
        console.error('Admin withdrawal action error:', err);
        res.status(500).json({ error: 'Failed to process withdrawal' });
    }
});

// ===================================
// PAYMENT PROCESSING
// ===================================

async function processSuccessfulPayment(paystackData) {
    const reference = paystackData.reference;

    try {
        // Get transaction
        const { data: tx, error: txError } = await supabaseAdmin
            .from('transactions')
            .select('*')
            .eq('reference', reference)
            .single();

        // If already success, exit (idempotent)
        if (tx && tx.status === 'success') {
            return;
        }

        if (!tx) {
            console.log('Transaction not found for reference:', reference);
            return;
        }

        // Update transaction status
        await supabaseAdmin
            .from('transactions')
            .update({ status: 'success' })
            .eq('reference', reference);

        const meta = tx.metadata;

        // If signup payment
        if (meta.type === 'signup') {
            const userId = tx.user_id;

            // Mark user as paid
            await supabaseAdmin
                .from('profiles')
                .update({ is_paid: true })
                .eq('id', userId);

            // Check for referral reward
            const { data: userProfile } = await supabaseAdmin
                .from('profiles')
                .select('referred_by')
                .eq('id', userId)
                .single();

            if (userProfile && userProfile.referred_by) {
                // Check if already paid referral
                const { data: existingRef } = await supabaseAdmin
                    .from('referrals')
                    .select('id')
                    .eq('referred_user_id', userId)
                    .single();

                if (!existingRef) {
                    // Credit referrer
                    const reward = REFERRAL_REWARD_UNITS;

                    // Update referrer wallet
                    const { data: referrerWallet } = await supabaseAdmin
                        .from('wallets')
                        .select('balance_units')
                        .eq('user_id', userProfile.referred_by)
                        .single();

                    await supabaseAdmin
                        .from('wallets')
                        .update({
                            balance_units: (referrerWallet?.balance_units || 0) + reward
                        })
                        .eq('user_id', userProfile.referred_by);

                    // Record referral transaction
                    const refTxRef = 'REF_BONUS_' + userId + '_' + Date.now();
                    const { data: refTx } = await supabaseAdmin
                        .from('transactions')
                        .insert({
                            reference: refTxRef,
                            user_id: userProfile.referred_by,
                            amount_units: reward,
                            status: 'success',
                            metadata: { type: 'referral_bonus', source: userId }
                        })
                        .select()
                        .single();

                    // Add referral record
                    await supabaseAdmin
                        .from('referrals')
                        .insert({
                            referrer_id: userProfile.referred_by,
                            referred_user_id: userId,
                            reward_units: reward,
                            status: 'paid',
                            awarded_tx_id: refTx?.id
                        });
                }
            }
        }

    } catch (err) {
        console.error('Payment processing error:', err);
    }
}

// ===================================
// ADMIN TASK MANAGEMENT
// ===================================

// Get all tasks (for users)
app.get('/tasks/available', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    try {
        // 1. Get Active Tasks
        const { data: tasks, error } = await supabaseAdmin
            .from('admin_tasks')
            .select('*')
            .eq('is_active', true)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Tasks fetch error:', error);
            return res.status(500).json({ error: error.message });
        }

        // 2. Get User's Submissions for these tasks
        const { data: submissions } = await supabaseAdmin
            .from('task_submissions')
            .select('task_id, status')
            .eq('user_id', userId);

        // 3. Map status to tasks
        const subMap = {};
        if (submissions) {
            submissions.forEach(s => {
                subMap[s.task_id] = s.status;
            });
        }

        const formatted = tasks.map(t => ({
            ...t,
            // Normalizing keys for frontend
            reward: t.reward_kes,
            action_url: t.url,
            // Status flags
            status: subMap[t.id] || null,
            completed: subMap[t.id] === 'approved' || subMap[t.id] === 'pending' // Consider pending as completed for UI to prevent re-submit
        }));

        res.json(formatted);
    } catch (err) {
        console.error('Tasks error:', err);
        res.status(500).json({ error: 'Failed to fetch tasks' });
    }
});

// Task Completion (Now requires Admin Approval)
app.post('/tasks/:id/complete', authenticateToken, async (req, res) => {
    const taskId = req.params.id;
    const userId = req.user.id;
    const { proof } = req.body; // Optional proof (text/link)

    try {
        // 1. Check if task exists and is active
        const { data: task, error: taskError } = await supabaseAdmin
            .from('admin_tasks')
            .select('*')
            .eq('id', taskId)
            .single();

        if (taskError || !task || !task.is_active) {
            return res.status(404).json({ message: 'Task not found or inactive' });
        }

        // 2. Check daily limit
        const today = new Date().toISOString().split('T')[0];
        const { count, error: countError } = await supabaseAdmin
            .from('task_submissions')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId)
            .eq('task_id', taskId)
            .gte('created_at', today)
            .neq('status', 'rejected'); // Count pending and approved

        if (countError) throw countError;

        if (count >= task.daily_limit) {
            return res.status(400).json({ message: 'Daily limit reached for this task' });
        }

        // 3. Create Submission (Pending)
        const { error: submitError } = await supabaseAdmin
            .from('task_submissions')
            .insert({
                user_id: userId,
                task_id: taskId,
                status: 'pending',
                proof_data: proof || null
            });

        if (submitError) throw submitError;

        res.json({
            success: true,
            message: 'Task submitted for review. Earnings will be credited after approval.'
        });

    } catch (err) {
        console.error('Task complete error:', err);
        res.status(500).json({ error: 'Failed to submit task' });
    }
});

// Admin: Get Submissions
app.get('/admin/task-submissions', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { data: submissions, error } = await supabaseAdmin
            .from('task_submissions')
            .select(`
                *,
                profiles ( email ),
                admin_tasks ( title, reward_kes )
            `)
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json(submissions);
    } catch (err) {
        console.error('Fetch submissions error:', err);
        res.status(500).json({ error: 'Failed to fetch submissions' });
    }
});

// Admin: Approve Submission
app.post('/admin/task-submissions/:id/approve', authenticateToken, requireAdmin, async (req, res) => {
    const submissionId = req.params.id;

    try {
        // 1. Get submission details
        const { data: submission, error: subError } = await supabaseAdmin
            .from('task_submissions')
            .select(`
                *,
                admin_tasks ( reward_kes )
            `)
            .eq('id', submissionId)
            .single();

        if (subError || !submission) {
            return res.status(404).json({ message: 'Submission not found' });
        }

        if (submission.status === 'approved') {
            return res.status(400).json({ message: 'Already approved' });
        }

        const reward = submission.admin_tasks.reward_kes;
        const userId = submission.user_id;

        // 2. Credit Wallet
        const { data: wallet } = await supabaseAdmin
            .from('wallets')
            .select('balance_units')
            .eq('user_id', userId)
            .single();

        const currentBalance = wallet ? wallet.balance_units : 0;
        // Convert KES to Units (KES * 100) if wallet uses units
        // Assuming system uses units (cents). If 5 KES, that's 500 units.
        // Wait, previously `reward_kes` was stored as integer (e.g. 5).
        // Does the wallet `balance_units` mean cents?
        // In `processSuccessfulPayment`: amount_units: reward (referral)
        // REFERRAL_REWARD_UNITS is usually defined.
        // Let's assume standard is Cents. 
        // 5 KES reward = 500 units.
        const rewardUnits = reward * 100;

        await supabaseAdmin
            .from('wallets')
            .update({ balance_units: currentBalance + rewardUnits })
            .eq('user_id', userId);

        // 3. Create Transaction Record
        await supabaseAdmin
            .from('transactions')
            .insert({
                user_id: userId,
                amount_units: rewardUnits,
                type: 'credit',
                status: 'success',
                reference: `TASK_${submissionId}_${Date.now()}`,
                metadata: { type: 'task_reward', task_id: submission.task_id }
            });

        // 4. Update Submission Status
        const { error: updateError } = await supabaseAdmin
            .from('task_submissions')
            .update({
                status: 'approved',
                reviewed_at: new Date().toISOString(),
                reviewed_by: req.user.id
            })
            .eq('id', submissionId);

        if (updateError) throw updateError;

        res.json({ success: true });

    } catch (err) {
        console.error('Approve submission error:', err);
        res.status(500).json({ error: 'Failed to approve task' });
    }
});

// Admin: Reject Submission
app.post('/admin/task-submissions/:id/reject', authenticateToken, requireAdmin, async (req, res) => {
    const submissionId = req.params.id;
    try {
        const { error } = await supabaseAdmin
            .from('task_submissions')
            .update({
                status: 'rejected',
                reviewed_at: new Date().toISOString(),
                reviewed_by: req.user.id
            })
            .eq('id', submissionId);

        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        console.error('Reject submission error:', err);
        res.status(500).json({ error: 'Failed to reject task' });
    }
});

// Admin: Get all tasks
app.get('/admin/tasks', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { data: tasks, error } = await supabaseAdmin
            .from('admin_tasks')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Admin tasks error:', error);
            return res.status(500).json({ error: error.message });
        }

        res.json(tasks || []);
    } catch (err) {
        console.error('Admin tasks error:', err);
        res.status(500).json({ error: 'Failed to fetch tasks' });
    }
});

// Admin: Create task
// Admin: Create task
app.post('/admin/tasks', authenticateToken, requireAdmin, async (req, res) => {
    const { title, description, reward_kes, task_type, url, daily_limit } = req.body;

    if (!title || !reward_kes) {
        return res.status(400).json({ message: 'Title and reward required' });
    }

    try {
        const reward = parseInt(reward_kes);
        const limit = parseInt(daily_limit);

        if (isNaN(reward)) {
            return res.status(400).json({ message: 'Invalid reward amount' });
        }

        const { data, error } = await supabaseAdmin
            .from('admin_tasks')
            .insert({
                title,
                description: description || '',
                reward_kes: reward,
                task_type: task_type || 'general',
                url: url || null,
                daily_limit: isNaN(limit) ? 1 : limit,
                is_active: true
            })
            .select()
            .single();

        if (error) {
            console.error('Task creation error:', error);
            return res.status(500).json({ error: error.message });
        }

        res.json({ success: true, task: data });
    } catch (err) {
        console.error('Admin task create error:', err);
        res.status(500).json({ error: 'Failed to create task' });
    }
});

// Admin: Update task
app.put('/admin/tasks/:id', authenticateToken, requireAdmin, async (req, res) => {
    const taskId = req.params.id;
    const { title, description, reward_kes, task_type, url, daily_limit, is_active } = req.body;

    try {
        const updates = {};
        if (title !== undefined) updates.title = title;
        if (description !== undefined) updates.description = description;
        if (reward_kes !== undefined) updates.reward_kes = parseInt(reward_kes);
        if (task_type !== undefined) updates.task_type = task_type;
        if (url !== undefined) updates.url = url;
        if (daily_limit !== undefined) updates.daily_limit = parseInt(daily_limit);
        if (is_active !== undefined) updates.is_active = is_active;

        const { error } = await supabaseAdmin
            .from('admin_tasks')
            .update(updates)
            .eq('id', taskId);

        if (error) {
            console.error('Task update error:', error);
            return res.status(500).json({ error: error.message });
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Admin task update error:', err);
        res.status(500).json({ error: 'Failed to update task' });
    }
});

// Admin: Delete task
app.delete('/admin/tasks/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { error } = await supabaseAdmin
            .from('admin_tasks')
            .delete()
            .eq('id', req.params.id);

        if (error) {
            console.error('Task delete error:', error);
            return res.status(500).json({ error: error.message });
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Admin task delete error:', err);
        res.status(500).json({ error: 'Failed to delete task' });
    }
});

// ===================================
// IMAGE UPLOAD (Base64 to Supabase Storage)
// ===================================

app.post('/admin/upload-image', authenticateToken, requireAdmin, async (req, res) => {
    const { imageData, fileName, folder } = req.body;

    if (!imageData || !fileName) {
        return res.status(400).json({ message: 'Image data and filename required' });
    }

    try {
        // Extract base64 data (remove data:image/...;base64, prefix if present)
        let base64Data = imageData;
        let mimeType = 'image/jpeg';

        if (imageData.includes('base64,')) {
            const parts = imageData.split('base64,');
            base64Data = parts[1];
            const mimeMatch = parts[0].match(/data:(.*?);/);
            if (mimeMatch) mimeType = mimeMatch[1];
        }

        const buffer = Buffer.from(base64Data, 'base64');
        const filePath = `${folder || 'thumbnails'}/${Date.now()}_${fileName}`;

        const { data, error } = await supabaseAdmin
            .storage
            .from('images')
            .upload(filePath, buffer, {
                contentType: mimeType,
                upsert: true
            });

        if (error) {
            console.error('Upload error:', error);
            return res.status(500).json({ error: error.message });
        }

        // Get public URL
        const { data: urlData } = supabaseAdmin
            .storage
            .from('images')
            .getPublicUrl(filePath);

        console.log('Image uploaded:', filePath);
        console.log('Public URL:', urlData.publicUrl);

        res.json({
            success: true,
            path: filePath,
            url: urlData.publicUrl
        });

    } catch (err) {
        console.error('Image upload error:', err);
        res.status(500).json({ error: 'Failed to upload image' });
    }
});

// ===================================
// ADMIN COURSE ORDERS MANAGEMENT
// ===================================

// Get all course orders (for admin)
app.get('/admin/course-orders', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { data: orders, error } = await supabaseAdmin
            .from('course_orders')
            .select(`
                id, user_id, course_id, amount_paid, transaction_ref, status, created_at,
                profiles ( email ),
                courses ( title )
            `)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Orders fetch error:', error);
            return res.status(500).json({ error: error.message });
        }

        const formatted = orders.map(o => ({
            ...o,
            email: o.profiles?.email || 'Unknown',
            courseTitle: o.courses?.title || 'Unknown'
        }));

        res.json(formatted);
    } catch (err) {
        console.error('Admin orders error:', err);
        res.status(500).json({ error: 'Failed to fetch orders' });
    }
});

// Approve or reject course order
app.post('/admin/course-orders/:id/action', authenticateToken, requireAdmin, async (req, res) => {
    const orderId = req.params.id;
    const { action } = req.body; // 'approve' or 'reject'
    const adminId = req.user.id;

    console.log('Order action:', { orderId, action, adminId });

    try {
        // Get order details
        const { data: order, error: orderError } = await supabaseAdmin
            .from('course_orders')
            .select('*')
            .eq('id', orderId)
            .single();

        if (orderError || !order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        if (order.status !== 'pending') {
            return res.json({ success: true, message: 'Order already processed' });
        }

        if (action === 'approve') {
            // Grant course access
            const { error: purchaseError } = await supabaseAdmin
                .from('course_purchases')
                .insert({
                    user_id: order.user_id,
                    course_id: order.course_id,
                    amount_paid: order.amount_paid,
                    transaction_ref: order.transaction_ref
                });

            if (purchaseError && purchaseError.code !== '23505') {
                console.error('Purchase grant error:', purchaseError);
                return res.status(500).json({ error: purchaseError.message });
            }

            // Update order status
            await supabaseAdmin
                .from('course_orders')
                .update({
                    status: 'approved',
                    approved_at: new Date().toISOString(),
                    approved_by: adminId
                })
                .eq('id', orderId);

            console.log('Order approved, course access granted');
            res.json({ success: true, message: 'Order approved, course unlocked for user' });

        } else if (action === 'reject') {
            await supabaseAdmin
                .from('course_orders')
                .update({ status: 'rejected' })
                .eq('id', orderId);

            res.json({ success: true, message: 'Order rejected' });
        } else {
            res.status(400).json({ error: 'Invalid action' });
        }

    } catch (err) {
        console.error('Order action error:', err);
        res.status(500).json({ error: 'Action failed' });
    }
});

// ===================================
// DEBUG / TEST TOOLS (ADMIN ONLY)
// ===================================

app.post('/admin/debug/set-balance', authenticateToken, async (req, res) => {
    const { userId, amount } = req.body;
    const adminId = req.user.id;

    console.log(`[DEBUG] Admin ${adminId} setting balance for ${userId} to ${amount}`);

    try {
        // 1. Verify Admin
        const { data: adminProfile } = await supabaseAdmin
            .from('profiles')
            .select('is_admin')
            .eq('id', adminId)
            .single();

        if (!adminProfile?.is_admin) {
            return res.status(403).json({ message: 'Unauthorized: Admin access required' });
        }

        // 2. Validate Input
        const newBalanceUnits = parseInt(amount) * PAYSTACK_UNIT;
        if (isNaN(newBalanceUnits)) {
            return res.status(400).json({ message: 'Invalid amount' });
        }

        // 3. Update Wallet Directly
        const { error: updateError } = await supabaseAdmin
            .from('wallets')
            .update({ balance_units: newBalanceUnits })
            .eq('user_id', userId);

        if (updateError) {
            console.error('[DEBUG] Wallet update failed:', updateError);
            return res.status(500).json({ message: 'Database update failed' });
        }

        // 4. Log Action
        console.log(`[DEBUG] SUCCESS: Set balance to ${amount} KES for user ${userId}`);

        res.json({ success: true, newBalance: amount });

    } catch (err) {
        console.error('[DEBUG] Error:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// ===================================
// ENHANCED ADMIN DATA ENDPOINT
// ===================================

app.get('/admin/stats', authenticateToken, requireAdmin, async (req, res) => {
    try {
        // Get various stats
        const { count: totalUsers } = await supabaseAdmin
            .from('profiles')
            .select('*', { count: 'exact', head: true });

        const { count: paidUsers } = await supabaseAdmin
            .from('profiles')
            .select('*', { count: 'exact', head: true })
            .eq('is_paid', true);

        const { count: pendingWithdrawals } = await supabaseAdmin
            .from('withdrawals')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'pending');

        const { count: totalCourses } = await supabaseAdmin
            .from('courses')
            .select('*', { count: 'exact', head: true });

        const { count: totalTasks } = await supabaseAdmin
            .from('admin_tasks')
            .select('*', { count: 'exact', head: true })
            .eq('is_active', true);

        // Get total revenue from successful transactions
        const { data: transactions } = await supabaseAdmin
            .from('transactions')
            .select('amount_units')
            .eq('status', 'success');

        const totalRevenue = transactions?.reduce((sum, t) => sum + (t.amount_units || 0), 0) || 0;

        res.json({
            totalUsers: totalUsers || 0,
            paidUsers: paidUsers || 0,
            pendingWithdrawals: pendingWithdrawals || 0,
            totalCourses: totalCourses || 0,
            totalTasks: totalTasks || 0,
            totalRevenueKES: totalRevenue / 100
        });

    } catch (err) {
        console.error('Admin stats error:', err);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

// Serve static files last (fallback)
app.use(express.static(path.join(__dirname)));
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
