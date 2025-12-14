# Deployment Guide for Earnio

Your application is now ready for deployment! Follow these steps to take your project from your local machine to the internet.

## 1. Prerequisites

Before deploying, ensure you have:
- A GitHub account.
- An account on a hosting platform (we recommend [Render](https://render.com) or [Railway](https://railway.app) for Node.js apps).
- Access to your Supabase and Paystack dashboards.

## 2. Prepare Your Code

1.  **Git Repository**: Initialize a git repository and push your code to GitHub.
    ```bash
    git init
    git add .
    git commit -m "Ready for deployment"
    # Follow GitHub instructions to push to a new repository
    ```

## 3. Deploy to Render (Recommended)

Render is the easiest way to host this monolithic (Express + Static Frontend) application.

1.  **New Web Service**: Go to [Render Dashboard](https://dashboard.render.com/) -> New + -> Web Service.
2.  **Connect GitHub**: Select the repository you just pushed.
3.  **Configure Service**:
    *   **Name**: `earnio-app` (or similar)
    *   **Runtime**: `Node`
    *   **Build Command**: `npm install`
    *   **Start Command**: `npm start`
    *   **Instance Type**: Free (for starting out)
4.  **Environment Variables**:
    *   Scroll down to "Environment Variables" and add these keys (copy values from your `.env.local`):
        *   `SUPABASE_URL`
        *   `SUPABASE_ANON_KEY`
        *   `SUPABASE_SERVICE_ROLE_KEY`
        *   `PAYSTACK_SECRET_KEY`

5.  **Deploy**: Click "Create Web Service". Render will build and deploy your app.

## 4. Post-Deployment Configuration

Once your app is live (you will get a URL like `https://earnio-app.onrender.com`), you need to update a few things.

### Paystack Webhook
1.  Log in to your [Paystack Dashboard](https://dashboard.paystack.com/).
2.  Go to **Settings** -> **API Hooks & Webhooks**.
3.  Enter your webhook URL: `https://<YOUR-RENDER-URL>/webhooks/paystack`
    *   Example: `https://earnio-app.onrender.com/webhooks/paystack`
4.  Save changes.

### Production Keys
When you are ready to accept real payments:
1.  **Backend**: Update `PAYSTACK_SECRET_KEY` in Render environment variables to your Live Secret Key (`sk_live_...`).
2.  **Frontend**: Update `pay_new.html` (line 46) and `script.js` (line 11) with your Live Public Key (`pk_live_...`).
    *   *Note: You will need to commit and push these changes to GitHub for Render to redeploy.*

## 5. Database Verification

Ensure your production database (Supabase) has all the necessary tables. Since you connected to the same Supabase instance during development, your tables should already be there.

If you create a **new** Supabase project for production:
1.  Go to Supabase SQL Editor.
2.  Run the contents of `supabase/schema.sql`.

## 6. Admin Access

The first user who signs up on the deployed app will be automatically assigned **Admin** status.
1.  Open your live website `https://<YOUR-RENDER-URL>`.
2.  Sign up with your email.
3.  You should be redirected to the admin dashboard payment flow (or dashboard if you skipped payment logic for admin).
4.  Check the `profiles` table in Supabase to confirm `is_admin` is `true`.

## Troubleshooting

-   **App Crashing?** Check the "Logs" tab in Render to see error messages.
-   **Database Connection Failed?** Double-check your `SUPABASE_URL` and keys in Render environment variables.
-   **Payments Not Working?** Check Paystack Webhook logs in Paystack Dashboard to see if they are reaching your server (200 OK).

Good luck with your launch! 🚀
