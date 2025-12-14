// Simple connection test
require('dotenv').config({ path: '.env.local' });
const { supabaseAdmin } = require('./lib/supabase');

async function quickTest() {
    console.log('\n========================================');
    console.log('SUPABASE CONNECTION TEST');
    console.log('========================================\n');

    try {
        // Test 1: Connection
        console.log('Testing connection to Supabase...');
        const { data, error } = await supabaseAdmin
            .from('profiles')
            .select('count');

        if (error) {
            console.log('\n❌ FAILED: Cannot connect to database');
            console.log('Error:', error.message);
            console.log('\nPlease check:');
            console.log('1. .env.local has correct SUPABASE_URL and keys');
            console.log('2. You ran schema.sql in Supabase SQL Editor');
            process.exit(1);
        }
        console.log('✅ Connected to database\n');

        // Test 2: Auth user creation
        console.log('Testing Auth user creation...');
        const testEmail = `test${Date.now()}@example.com`;
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email: testEmail,
            password: 'Test123!@#',
            email_confirm: true
        });

        if (authError) {
            console.log('\n❌ FAILED: Cannot create Auth user');
            console.log('Error:', authError.message);
            console.log('\nPlease check:');
            console.log('1. Go to Supabase Dashboard → Authentication → Settings');
            console.log('2. Disable "Email confirmations" for development');
            console.log('3. Set Site URL to http://localhost:3000');
            process.exit(1);
        }

        const userId = authData.user.id;
        console.log(`✅ Auth user created (${userId.substring(0, 8)}...)\n`);

        // Test 3: Profile creation
        console.log('Testing Profile creation...');
        const { error: profileError } = await supabaseAdmin
            .from('profiles')
            .insert({
                id: userId,
                email: testEmail,
                referral_code: 'TEST' + Date.now(),
                is_admin: false
            });

        if (profileError) {
            console.log('\n❌ FAILED: Cannot create profile');
            console.log('Error:', profileError.message);
            await supabaseAdmin.auth.admin.deleteUser(userId);
            process.exit(1);
        }
        console.log('✅ Profile created\n');

        // Test 4: Wallet creation
        console.log('Testing Wallet creation...');
        const { error: walletError } = await supabaseAdmin
            .from('wallets')
            .insert({ user_id: userId });

        if (walletError) {
            console.log('\n❌ FAILED: Cannot create wallet');
            console.log('Error:', walletError.message);
        } else {
            console.log('✅ Wallet created\n');
        }

        // Cleanup
        console.log('Cleaning up test data...');
        await supabaseAdmin.auth.admin.deleteUser(userId);
        console.log('✅ Test data cleaned\n');

        console.log('========================================');
        console.log('✅ ALL TESTS PASSED!');
        console.log('========================================');
        console.log('\nYour Supabase setup is working correctly!');
        console.log('You can now test signup at: http://localhost:3000/auth/signup\n');

    } catch (err) {
        console.log('\n❌ UNEXPECTED ERROR:', err.message);
        console.log('\nFull error:', err);
        process.exit(1);
    }
}

quickTest();
