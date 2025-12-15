const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const API_URL = 'http://localhost:3000';

async function test() {
    console.log('--- Debugging Tasks Endpoint ---');

    try {
        // 1. Create/Get Test User
        const email = 'task_debug_' + Date.now() + '@test.com';
        const password = 'password123';
        console.log('Creating user:', email);

        const { data: auth, error: authError } = await supabase.auth.admin.createUser({
            email,
            password,
            email_confirm: true
        });

        if (authError) throw authError;
        const userId = auth.user.id;

        // Ensure profile
        await supabase.from('profiles').upsert({ id: userId, email, is_paid: true });

        // 2. Login
        console.log('Logging in...');
        const login = await axios.post(`${API_URL}/auth/login`, { email, password });
        const token = login.data.token;
        console.log('Token received');

        // 3. Fetch Tasks
        console.log('Fetching /tasks/available...');
        try {
            const res = await axios.get(`${API_URL}/tasks/available`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            console.log('Response Status:', res.status);
            console.log('Response Data Type:', typeof res.data);
            console.log('Response Data:', JSON.stringify(res.data, null, 2));

            if (Array.isArray(res.data)) {
                console.log('✅ Response is an array (Correct)');
                if (res.data.length > 0) {
                    console.log('First Task Keys:', Object.keys(res.data[0]));
                    console.log('First Task Sample:', JSON.stringify(res.data[0], null, 2));
                } else {
                    console.log('⚠️ No tasks found in DB');
                }
            } else if (res.data.tasks) {
                console.log('⚠️ Response is object with tasks property (Frontend needs adjustment)');
            } else {
                console.log('❌ Unexpected response format');
            }

        } catch (e) {
            console.error('❌ Fetch failed:', e.response?.data || e.message);
        }

        // Cleanup
        await supabase.auth.admin.deleteUser(userId);

    } catch (err) {
        console.error('Test Failed:', err);
    }
}

test();
