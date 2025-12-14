/**
 * Test script to directly add a resource bypassing the frontend
 * Run with: node scripts/test-add-resource.js
 */
const fetch = require('node-fetch');
require('dotenv').config({ path: '.env.local' });

const BASE_URL = 'http://localhost:3000';

// You need to paste your admin JWT token here
// Get it from localStorage in browser console: localStorage.getItem('token')
const ADMIN_TOKEN = 'PASTE_YOUR_TOKEN_HERE';

async function testAddResource() {
    console.log('Testing resource addition...');

    const payload = {
        course_id: 1, // Use an actual course ID from your database
        type: 'video',
        title: 'Test Video',
        url: 'https://example.com/video'
    };

    console.log('Payload:', payload);

    try {
        const res = await fetch(`${BASE_URL}/admin/resources`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ADMIN_TOKEN}`
            },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        console.log('Status:', res.status);
        console.log('Response:', JSON.stringify(data, null, 2));

        if (res.ok) {
            console.log('✅ SUCCESS - Resource added!');
        } else {
            console.log('❌ FAILED:', data.error || data.message);
        }
    } catch (err) {
        console.error('Network Error:', err.message);
    }
}

testAddResource();
