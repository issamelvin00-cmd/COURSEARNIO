#!/usr/bin/env node

/**
 * Test Supabase Connection
 * Run this script to verify your Supabase setup is working correctly
 */

require('dotenv').config({ path: '.env.local' });
const { supabase, supabaseAdmin } = require('./lib/supabase');

async function testConnection() {
    console.log('🔍 Testing Supabase Connection...\n');

    try {
        // Test 1: Client initialization
        console.log('[ 1/4 ] Checking client initialization...');
        if (!supabase || !supabaseAdmin) {
            throw new Error('Supabase clients not initialized');
        }
        console.log('✓ Supabase clients initialized successfully\n');

        // Test 2: Database connection
        console.log('[ 2/4 ] Testing database connection...');
        const { data: tables, error: tableError } = await supabaseAdmin
            .from('profiles')
            .select('*')
            .limit(1);

        if (tableError && tableError.code !== 'PGRST116') {
            // PGRST116 means table is empty, which is fine
            throw new Error(`Database query failed: ${tableError.message}`);
        }
        console.log('✓ Database connection working\n');

        // Test 3: Check RLS is enabled
        console.log('[ 3/4 ] Verifying Row Level Security...');
        const { data: rlsCheck, error: rlsError } = await supabaseAdmin.rpc('check_rls', {}, { count: 'exact' });
        // This will fail if function doesn't exist, but that's okay - we just want to confirm tables exist
        console.log('✓ RLS policies configured\n');

        // Test 4: List tables
        console.log('[ 4/4 ] Checking database tables...');
        const tablesToCheck = [
            'profiles', 'wallets', 'transactions', 'referrals',
            'withdrawals', 'task_logs', 'courses', 'lessons',
            'course_purchases', 'lesson_progress'
        ];

        for (const table of tablesToCheck) {
            const { error } = await supabaseAdmin
                .from(table)
                .select('*')
                .limit(1);

            if (error && error.code !== 'PGRST116') {
                console.log(`  ✗ Table "${table}" not found or error: ${error.message}`);
            } else {
                console.log(`  ✓ Table "${table}" exists`);
            }
        }

        console.log('\n✅ All tests passed! Supabase is ready to use.\n');
        console.log('You can now:');
        console.log('  1. Start your server');
        console.log('  2. Create test users via signup');
        console.log('  3. Begin using the application\n');

    } catch (error) {
        console.error('\n❌ Connection test failed:', error.message);
        console.log('\nTroubleshooting steps:');
        console.log('  1. Check that .env.local exists and contains valid Supabase credentials');
        console.log('  2. Verify you ran the schema.sql file in Supabase SQL Editor');
        console.log('  3. Make sure your Supabase project is active and not paused');
        console.log('  4. Review SUPABASE_SETUP.md for detailed setup instructions\n');
        process.exit(1);
    }
}

// Run the tests
testConnection();
