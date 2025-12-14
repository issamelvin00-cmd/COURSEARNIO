# 🔧 Fix "Database error creating new user"

## The Problem

The diagnostic test passed ✅, but signup is failing with "Database error creating new user" ❌

This means your database is fine, but **Supabase Auth settings need configuration**.

## Solution: Configure Auth in Supabase

### Step 1: Go to Auth Settings

1. Open your Supabase Dashboard: https://supabase.com/dashboard
2. Select your project
3. Click **Authentication** in the left sidebar
4. Click **Providers** or **Configuration**

### Step 2: Configure Email Provider

1. Find **Email** provider
2. Make sure it's **ENABLED** ✅
3. Look for these settings:

#### Disable Email Confirmations (for development):
- Find **"Confirm email"** or **"Enable email confirmations"**
- **TURN IT OFF** (uncheck or disable)
- This allows users to sign up without email verification

### Step 3: Configure URL Settings

1. In the same Authentication section, click **URL Configuration** or **Settings**
2. Set these values:

**Site URL:**
```
http://localhost:3000
```

**Redirect URLs:** (add this)
```
http://localhost:3000/**
```

3. Click **Save**

### Step 4: Check for Existing Users

The test email might already exist from our diagnostic test:

1. Go to **Authentication** → **Users**
2. Look for `test@example.com` or `admin@test.com`
3. If found, **delete it** (click the three dots → Delete)

### Step 5: Try Different Email

After making the changes above, try signing up with a **different email** in the test page:

```
admin123@test.com
password123
```

---

## Quick Checklist

Go through these in your Supabase Dashboard:

- [ ] Authentication → Providers → Email is **enabled**
- [ ] **"Confirm email"** is **DISABLED** (for dev)
- [ ] Site URL is set to `http://localhost:3000`
- [ ] Deleted any test users from Authentication → Users
- [ ] Tried with a fresh email address

---

## After Making Changes

1. **No need to restart the server** - Auth settings apply immediately
2. Go back to `http://localhost:3000/test-auth.html`
3. Try a **different email**: `newadmin@test.com`
4. Click **Sign Up**

You should see ✅ SUCCESS!

---

## Still Not Working?

If you're still getting the error:

1. Check if you're using the correct **Service Role Key** in `.env.local`
   - Go to Settings → API
   - Copy the **service_role** key (the long one)
   - Make sure it matches `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`

2. Check browser console (F12) for any additional error messages

3. Take a screenshot of your Supabase Auth Provider settings and share it
