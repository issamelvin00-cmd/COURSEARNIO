# Deployment Guide for Earnio

This guide explains how to deploy your application to a hosting provider like **Render** (recommended for free tier) or **Heroku**, and how to connect your **Supabase** database.

## Prerequisites

1.  **Git Codebase**: Ensure your code is pushed to a GitHub repository.
2.  **Supabase Project**: You should already have your Supabase URL and Keys.
3.  **Paystack Keys**: You need your Paystack Public and Secret keys.

## Option 1: Deploy to Render (Recommended)

1.  **Create Account**: Sign up at [dashboard.render.com](https://dashboard.render.com/).
2.  **New Web Service**: Click "New +" and select "Web Service".
3.  **Connect GitHub**: Select your repository.
4.  **Configure Service**:
    *   **Name**: `earnio-app` (or similar)
    *   **Region**: Closest to you (e.g., Frankfurt or Ohio)
    *   **Branch**: `main`
    *   **Root Directory**: Leave blank (default is root)
    *   **Runtime**: `Node`
    *   **Build Command**: `npm install`
    *   **Start Command**: `npm start`
    *   **Plan**: Free

5.  **Environment Variables**:
    Scroll down to "Environment Variables" and add these keys (copy from your `.env` or setup):
    *   `SUPABASE_URL`: `your_supabase_url`
    *   `SUPABASE_KEY`: `your_supabase_anon_key`
    *   `SUPABASE_SERVICE_ROLE_KEY`: `your_service_role_key` (for admin operations)
    *   `PAYSTACK_SECRET_KEY`: `your_paystack_secret_key`
    *   `PAYSTACK_PUBLIC_KEY`: `your_paystack_public_key`
    *   `NODE_ENV`: `production`

6.  **Deploy**: Click "Create Web Service". Render will build and deploy your app.

## Option 2: Deploy to Heroku

1.  **Create App**: `heroku create earnio-app`
2.  **Add Config Vars**:
    Go to Settings -> Config Vars and add all the variables listed above.
3.  **Deploy**:
    ```bash
    git push heroku main
    ```

## Database Setup (Supabase)

Ensure your database tables are created. If you haven't run the SQL scripts yet, go to the Supabase SQL Editor and run the contents of:
*   `supabase/schema.sql` (if exists)
*   `supabase/chapters_schema.sql` (for courses feature)

## Verification

Once deployed, visit your Render/Heroku URL (e.g., `https://earnio-app.onrender.com`).
1.  **Check Indices**: The landing page should load with the green theme.
2.  **Login**: Try logging in with an admin account.
3.  **Test Payment**: If using Paystack Test Mode, try purchasing a course.

## Troubleshooting

*   **Logs**: On Render, click the "Logs" tab to see server output if something crashes.
*   **Whitelisting**: If database connection fails, ensure Supabase "Network Restrictions" allow connections from anywhere (0.0.0.0/0) or whitelists Render's IPs.
