# 🧪 Testing Your Supabase Integration

Your server is now running successfully! Here's how to test all features.

## ✅ Server Status

**Server is running on:** `http://localhost:3000`

---

## Method 1: Using Postman (Recommended)

### 1. Sign Up (Creates Admin User)

```
POST http://localhost:3000/auth/signup
Content-Type: application/json

{
  "email": "admin@yourdomain.com",
  "password": "yourpassword123"
}
```

**Expected Response:**
```json
{
  "token": "eyJhbGc...(long token)",
  "needsPayment": true,
  "user": {
    "id": "uuid-string",
    "email": "admin@yourdomain.com",
    "referralCode": "USER123456"
  }
}
```

> **Important:** Save the token! You'll need it for authenticated requests.
> **Note:** The first user automatically becomes admin!

### 2. Login

```
POST http://localhost:3000/auth/login
Content-Type: application/json

{
  "email": "admin@yourdomain.com",
  "password": "yourpassword123"
}
```

### 3. Test Protected Endpoint (Dashboard)

```
GET http://localhost:3000/dashboard/data
Authorization: Bearer YOUR_TOKEN_HERE
```

**Expected Response:**
```json
{
  "user": {
    "email": "admin@yourdomain.com",
    "referralCode": "USER123456",
    "isPaid": false,
    "isAdmin": true
  },
  "wallet": {
    "balanceKES": 0
  },
  "referrals": []
}
```

### 4. Create a Test Course (Admin Only)

```
POST http://localhost:3000/admin/courses
Authorization: Bearer YOUR_TOKEN_HERE
Content-Type: application/json

{
  "title": "Intro to Web Development",
  "description": "Learn the basics",
  "price": 500,
  "duration_hours": 10
}
```

### 5. Publish the Course

```
PUT http://localhost:3000/admin/courses/1/publish
Authorization: Bearer YOUR_TOKEN_HERE
Content-Type: application/json

{
  "is_published": true
}
```

### 6. View Public Courses

```
GET http://localhost:3000/courses
```

---

## Method 2: Using Browser DevTools

1. Open http://localhost:3000 in your browser
2. Open DevTools (F12)
3. Go to Console tab
4. Run these commands:

```javascript
// Sign Up
fetch('http://localhost:3000/auth/signup', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'test@example.com',
    password: 'password123'
  })
})
.then(r => r.json())
.then(data => {
  console.log('Signup Response:', data);
  window.authToken = data.token; // Save token
});

// After signup, test dashboard
fetch('http://localhost:3000/dashboard/data', {
  headers: { 'Authorization': `Bearer ${window.authToken}` }
})
.then(r => r.json())
.then(console.log);
```

---

## Method 3: Create Test HTML Page

Create `test-api.html` in your project root:

```html
<!DOCTYPE html>
<html>
<head>
    <title>API Test</title>
    <style>
        body { font-family: Arial; padding: 20px; }
        .test-section { margin: 20px 0; padding: 15px; border: 1px solid #ccc; }
        button { padding: 10px 20px; margin: 5px; }
        pre { background: #f4f4f4; padding: 10px; overflow: auto; }
    </style>
</head>
<body>
    <h1>Supabase API Test</h1>
    
    <div class="test-section">
        <h2>1. Sign Up</h2>
        <input type="email" id="email" placeholder="Email" value="admin@test.com">
        <input type="password" id="password" placeholder="Password" value="password123">
        <button onclick="testSignup()">Sign Up</button>
        <pre id="signup-result"></pre>
    </div>

    <div class="test-section">
        <h2>2. Dashboard (requires token)</h2>
        <button onclick="testDashboard()">Get Dashboard Data</button>
        <pre id="dashboard-result"></pre>
    </div>

    <div class="test-section">
        <h2>3. View Courses</h2>
        <button onclick="testCourses()">Get Courses</button>
        <pre id="courses-result"></pre>
    </div>

    <script>
        let authToken = '';

        async function testSignup() {
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;
            
            const response = await fetch('http://localhost:3000/auth/signup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            
            const data = await response.json();
            authToken = data.token;
            document.getElementById('signup-result').textContent = JSON.stringify(data, null, 2);
        }

        async function testDashboard() {
            if (!authToken) {
                alert('Please sign up first to get a token!');
                return;
            }
            
            const response = await fetch('http://localhost:3000/dashboard/data', {
                headers: { 'Authorization': `Bearer ${authToken}` }
            });
            
            const data = await response.json();
            document.getElementById('dashboard-result').textContent = JSON.stringify(data, null, 2);
        }

        async function testCourses() {
            const response = await fetch('http://localhost:3000/courses');
            const data = await response.json();
            document.getElementById('courses-result').textContent = JSON.stringify(data, null, 2);
        }
    </script>
</body>
</html>
```

Then open `http://localhost:3000/test-api.html` in your browser.

---

## ✅ Verification Checklist

- [ ] Sign up successful (returns token and user data)
- [ ] First user is marked as admin (`isAdmin: true`)
- [ ] Login works with the same credentials
- [ ] Dashboard endpoint returns user data with token
- [ ] Admin can create courses
- [ ] Public endpoints work without authentication
- [ ] Row Level Security prevents unauthorized access

---

## 🔍 Verify in Supabase Dashboard

1. Go to your Supabase project dashboard
2. Click **Authentication** → Users
3. You should see your test user(s)
4. Click **Table Editor** → profiles
5. Verify data matches what the API returns
6. Check **wallets**, **transactions**, **courses** tables

---

## 🐛 Common Issues

### "401 Unauthorized"
- Make sure you're sending the token in headers: `Authorization: Bearer YOUR_TOKEN`
- Token expires after 1 hour - login again to get a new one

### "403 Forbidden" on admin endpoints
- Check that `is_admin` is `true` in the profiles table
- First user should auto-become admin

### No data returned
- Check RLS policies in Supabase Table Editor
- Make sure tables have data
- Check server logs for errors

---

## 🎯 Next Steps After Testing

1. **Test Payment Flow** - Use PayStack test mode
2. **Test Referral System** - Sign up with referral code
3. **Test Course Purchase** - Buy a test course
4. **Test Withdrawals** - Request withdrawal, admin approve/reject
5. **Deploy** - Once everything works locally

---

## Server Logs

Watch your terminal where `node server.js` is running. You should see logs like:
```
[2024-12-08T12:33:19.000Z] POST /auth/signup
[2024-12-08T12:33:20.000Z] GET /dashboard/data
```
