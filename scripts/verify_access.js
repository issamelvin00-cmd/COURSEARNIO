const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const API_URL = 'http://localhost:3000';

async function test() {
    console.log('--- Testing Course Access Logic ---');

    try {
        // 1. Create/Get Admin User
        console.log('\n1. Setting up Admin User...');
        const adminEmail = 'admin_test_' + Date.now() + '@example.com';
        const password = 'password123';
        const { data: adminAuth, error: adminErr } = await supabase.auth.admin.createUser({
            email: adminEmail,
            password: password,
            email_confirm: true
        });
        if (adminErr) throw adminErr;
        const adminId = adminAuth.user.id;

        // Ensure admin profile
        await supabase.from('profiles').upsert({
            id: adminId,
            email: adminEmail,
            is_admin: true,
            is_paid: true
        });
        console.log('Admin user created:', adminEmail);

        // Login Admin
        const adminLogin = await axios.post(`${API_URL}/auth/login`, { email: adminEmail, password });
        const adminToken = adminLogin.data.token;

        // 2. Create/Get Regular User
        console.log('\n2. Setting up Regular User...');
        const userEmail = 'user_test_' + Date.now() + '@example.com';
        const { data: userAuth, error: userErr } = await supabase.auth.admin.createUser({
            email: userEmail,
            password: password,
            email_confirm: true
        });
        if (userErr) throw userErr;
        const userId = userAuth.user.id;

        await supabase.from('profiles').upsert({
            id: userId,
            email: userEmail,
            is_admin: false,
            is_paid: false
        });
        console.log('Regular user created:', userEmail);

        // Login User
        const userLogin = await axios.post(`${API_URL}/auth/login`, { email: userEmail, password });
        const userToken = userLogin.data.token;

        // 3. Create a Test Course & Chapter
        console.log('\n3. Creating Test Course...');
        const { data: course, error: courseErr } = await supabase
            .from('courses')
            .insert({
                title: 'Access Test Course',
                price: 1000,
                is_published: true,
                created_by: adminId
            })
            .select()
            .single();
        if (courseErr) throw courseErr;
        console.log('Course created:', course.id);

        const { data: chapter, error: chapterErr } = await supabase
            .from('chapters')
            .insert({
                course_id: course.id,
                title: 'Test Chapter',
                order_num: 1,
                content_html: '<p>Secret Content</p>'
            })
            .select()
            .single();
        if (chapterErr) throw chapterErr;
        console.log('Chapter created:', chapter.id);

        // 4. Test Admin Access (Should Succeed)
        console.log('\n4. Testing Admin Access to Chapter...');
        try {
            const adminResp = await axios.get(`${API_URL}/chapters/${chapter.id}`, {
                headers: { Authorization: `Bearer ${adminToken}` }
            });
            console.log('✅ Admin Access Success:', adminResp.data.title);
        } catch (e) {
            console.error('❌ Admin Access Failed:', e.response?.data || e.message);
        }

        // 5. Test Regular User Access (Should Fail)
        console.log('\n5. Testing User Access (No Purchase) to Chapter...');
        try {
            await axios.get(`${API_URL}/chapters/${chapter.id}`, {
                headers: { Authorization: `Bearer ${userToken}` }
            });
            console.error('❌ User Access SHOULD have failed but succeeded.');
        } catch (e) {
            if (e.response?.status === 403) {
                console.log('✅ User Access correctly denied (403)');
            } else {
                console.error('❌ User Access Failed with unexpected error:', e.response?.status);
            }
        }

        // 6. Grant Access to User and Retry
        console.log('\n6. Granting Access to User...');
        await supabase.from('course_purchases').insert({
            user_id: userId,
            course_id: course.id,
            amount_paid: 1000,
            transaction_ref: 'TEST_REF'
        });

        console.log('Testing User Access (With Purchase)...');
        try {
            const userResp = await axios.get(`${API_URL}/chapters/${chapter.id}`, {
                headers: { Authorization: `Bearer ${userToken}` }
            });
            console.log('✅ User Access Success:', userResp.data.title);
        } catch (e) {
            console.error('❌ User Access Failed after purchase:', e.response?.data || e.message);
        }

        // Cleanup
        console.log('\nCleaning up...');
        await supabase.from('chapters').delete().eq('id', chapter.id);
        await supabase.from('course_purchases').delete().eq('course_id', course.id);
        await supabase.from('courses').delete().eq('id', course.id);
        await supabase.auth.admin.deleteUser(adminId);
        await supabase.auth.admin.deleteUser(userId);
        console.log('Done.');

    } catch (err) {
        console.error('Test Failed:', err);
    }
}

test();
