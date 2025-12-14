
require('dotenv').config({ path: '.env.local' });
const { supabaseAdmin } = require('../lib/supabase');

async function testTaskCreation() {
    console.log('Testing task creation...');

    // Test 1: Simple task
    console.log('\nTest 1: Simple task (Defaults)');
    try {
        const { data, error } = await supabaseAdmin
            .from('admin_tasks')
            .insert({
                title: 'Test Task 1',
                description: 'Description 1',
                reward_kes: 5,
                task_type: 'general',
                url: null,
                daily_limit: 1,
                is_active: true
            })
            .select()
            .single();

        if (error) console.error('Test 1 Failed:', error.message);
        else console.log('Test 1 Success:', data.id);
    } catch (e) { console.error(e); }

    // Test 2: Second task (Simulation of "second one failed")
    console.log('\nTest 2: Second task');
    try {
        const { data, error } = await supabaseAdmin
            .from('admin_tasks')
            .insert({
                title: 'Test Task 2',
                description: 'Description 2',
                reward_kes: 10,
                task_type: 'video', // Different type
                url: 'https://youtube.com',
                daily_limit: 1,
                is_active: true
            })
            .select()
            .single();

        if (error) console.error('Test 2 Failed:', error.message);
        else console.log('Test 2 Success:', data.id);
    } catch (e) { console.error(e); }

    // Test 3: String Inputs (Simulation of potential form data type handling by Supabase)
    // Note: server.js parseInt()'s reward_kes, but NOT daily_limit in current code. 
    console.log('\nTest 3: String Inputs (daily_limit as string)');
    try {
        const { data, error } = await supabaseAdmin
            .from('admin_tasks')
            .insert({
                title: 'Test Task 3',
                description: 'Description 3',
                reward_kes: 5,
                task_type: 'general',
                url: '',
                daily_limit: "2", // Passed as string
                is_active: true
            })
            .select()
            .single();

        if (error) console.error('Test 3 Failed:', error.message);
        else console.log('Test 3 Success:', data.id);
    } catch (e) { console.error(e); }
}

testTaskCreation();
