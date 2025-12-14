# 🚀 Quick Start Guide

## 1. Create Supabase Project (5 minutes)

1. Go to [https://supabase.com](https://supabase.com)
2. Click "New Project"
3. Fill in details and wait for setup
4. Go to **Settings → API** and copy your keys

## 2. Configure Environment (1 minute)

```bash
copy .env.example .env.local
```

Then edit `.env.local` with your Supabase keys from step 1.

## 3. Set Up Database (2 minutes)

1. In Supabase dashboard, go to **SQL Editor**
2. Open `supabase/schema.sql` from your project
3. Copy all contents and paste into SQL Editor
4. Click **Run**
5. Verify in **Table Editor** - should see 10 tables

## 4. Test Connection (30 seconds)

```bash
node scripts/test-supabase-connection.js
```

Should see all checkmarks ✓

## 5. Start Server (10 seconds)

```bash
node server.js
```

## 6. Test Signup (1 minute)

Use Postman/Insomnia or curl:

```bash
curl -X POST http://localhost:3000/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@test.com",
    "password": "password123"
  }'
```

**The first user becomes admin automatically!**

---

## 📁 Important Files

| File | Purpose |
|------|---------|
| `.env.local` | Your Supabase credentials (create from .env.example) |
| `supabase/schema.sql` | Database schema - run in Supabase SQL Editor |
| `server.js` | Main application (migrated to Supabase) |
| `server.js.sqlite.backup` | Original SQLite version (backup) |
| `SUPABASE_SETUP.md` | Detailed setup instructions |
| `scripts/test-supabase-connection.js` | Connection test |

---

## 🆘 Quick Troubleshooting

### Error: "Missing Supabase environment variables"
→ Rename `.env.example` to `.env.local` and fill in your keys

### Error: "Database query failed"  
→ Run `supabase/schema.sql` in Supabase SQL Editor

### Authentication works but no data
→ Check RLS is enabled (shield icon in Table Editor)

---

## 📚 Full Documentation

- **Setup Guide**: `SUPABASE_SETUP.md`
- **Technical Details**: `walkthrough.md` (in artifacts)
- **Implementation Plan**: `implementation_plan.md` (in artifacts)
