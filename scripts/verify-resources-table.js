const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing env vars');
    process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function checkTable() {
    console.log('Checking course_resources table...');

    // 1. Try to select
    const { data, error } = await supabaseAdmin
        .from('course_resources')
        .select('count')
        .limit(1);

    if (error) {
        console.error('❌ Table Check Failed:', error.message);
        if (error.message.includes('does not exist')) {
            console.log('\nCAUSE: The "course_resources" table has not been created yet.');
            console.log('SOLUTION: Run the SQL in supabase/resources_schema.sql');
        }
    } else {
        console.log('✅ Table "course_resources" exists and is accessible.');
        console.log('Row count check result:', data);
    }
}

checkTable();
