# MyISKCON Accounts — Vercel Deployment Guide

This guide walks you through deploying the Temple Donation Management System to Vercel with Neon Postgres.

---

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Vercel         │────▶│  Next.js API     │────▶│  Neon Postgres  │
│  (Frontend +    │     │  Routes          │     │  (Database)     │
│   API Routes)   │     │  (Node.js)       │     │                 │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                               │
                               ├────▶ Razorpay API (payments)
                               └────▶ bhashsms API (WhatsApp)
```

**Stack:** Next.js 16 (App Router, TypeScript) · Neon Postgres · bcrypt + AES-256-GCM · Razorpay · Vercel Cron

---

## Step 0: Rotate the Razorpay Key (CRITICAL)

The old `Code.gs` contained a **live** Razorpay Key Secret in plaintext. Before deploying:

1. Log into the [Razorpay Dashboard](https://dashboard.razorpay.com/)
2. Go to **Settings → API Keys → Generate New Key**
3. Save the new Key ID and Key Secret — you'll need them in Step 3
4. **Delete/regenerate** the old key so the leaked secret is invalidated

---

## Step 1: Create a Neon Postgres Database

1. Go to the [Vercel Dashboard](https://vercel.com/dashboard)
2. Click **Storage → Create Database Store**
3. Select **Neon Postgres** (the native Vercel integration)
4. Name it `myiskcon-db`
5. Choose the region closest to your users (e.g., `ap-south-1` for India)
6. Click **Create**
7. Vercel will auto-inject `DATABASE_URL` into your project's environment variables

---

## Step 2: Push the Code to GitHub

```bash
cd "/Users/venugopal/Iskcon Accounts Projects/MyISKCONAccounts_googleSheets_vercel"

# Initialize git (if not already)
git init
git add .
git status  # verify no .env, .xlsx, or donors_with_transactions.json is staged

# Commit
git commit -m "Initial Vercel + Next.js migration"

# Push to GitHub
git remote add origin https://github.com/YOUR_USERNAME/myiskcon-accounts.git
git branch -M main
git push -u origin main
```

**IMPORTANT:** The `.gitignore` is configured to exclude:
- `.env` / `.env.*` (secrets)
- `*.xlsx` (donor PII)
- `scripts/donors_with_transactions.json` (donor PII)
- `Code.gs` / `myiskcon.html` (legacy files with hardcoded secrets)

---

## Step 3: Import to Vercel & Set Environment Variables

1. Go to [vercel.com/new](https://vercel.com/new)
2. Import your GitHub repository
3. **Before clicking Deploy**, go to **Environment Variables** and add ALL of these:

| Variable | Value | Notes |
|----------|-------|-------|
| `DATABASE_URL` | *(auto-injected by Neon)* | From Step 1 |
| `DATABASE_URL_DIRECT` | *(copy from Neon dashboard)* | Non-pooled connection for migrations |
| `SESSION_SECRET` | `openssl rand -hex 48` | Run this command locally to generate |
| `LEGACY_PASSWORD_SALT` | *(copy from old Code.gs line 39)* | Required for migrated user logins |
| `LEGACY_ENCRYPTION_KEY` | *(copy from old Code.gs line 42)* | Required to decrypt migrated PAN/email |
| `ENCRYPTION_KEY_HEX` | `openssl rand -hex 32` | New AES-256-GCM key (64 hex chars) |
| `SESSION_TIMEOUT_HOURS` | `24` | |
| `SUPERADMIN_USERNAME` | `Sivatma Govinda Dasa` | |
| `DEVELOPER_USERNAME` | `Visnu Jagatpalaka Dasa` | |
| `RAZORPAY_KEY_ID` | *(from Step 0)* | New key ID |
| `RAZORPAY_KEY_SECRET` | *(from Step 0)* | New key secret |
| `BHASHSMS_USER` | *(your bhashsms user)* | |
| `BHASHSMS_PASSWORD` | *(your bhashsms password)* | |
| `BHASHSMS_SENDER_ID` | *(your bhashsms sender ID)* | |
| `BHASHSMS_TEMPLATE` | `donor_login_202526b` | |
| `CRON_SECRET` | `openssl rand -hex 32` | For Vercel Cron auth |
| `AUDIT_LOG_ENABLED` | `false` | Set `true` in production later |

4. Click **Deploy**

---

## Step 4: Push the Database Schema

Run this locally (you need `DATABASE_URL_DIRECT` in your `.env`):

```bash
# Create a local .env file with at minimum:
# DATABASE_URL_DIRECT=postgres://...  (from Vercel dashboard → Storage → your db → Connect)

npm install
npm run db:push
```

This creates all 14+ tables (users, donors, bookings, transactions, sevas, centers, temples, departments, sessions, audit_log, events, event_bookings, bank_accounts, payment_gateways, qr_scans, app_config).

---

## Step 5: Initialize the Database

Call the `initializeDatabase` endpoint to seed default centers and set up the superadmin password:

```bash
# Replace YOUR_VERCEL_URL with your deployment URL
curl -X POST https://YOUR_VERCEL_URL.vercel.app/api/rpc \
  -H "Content-Type: application/json" \
  -d '{"action":"initializeDatabase","superadminPassword":"YOUR_NEW_PASSWORD","developerPassword":"YOUR_DEV_PASSWORD"}'
```

Or visit: `https://YOUR_VERCEL_URL.vercel.app/api/rpc?action=ping` to verify the backend is running.

---

## Step 6: Migrate Existing Data

Run the migration script locally (needs `DATABASE_URL` and the legacy keys in `.env`):

```bash
npm run migrate
```

This reads `scripts/donors_with_transactions.json` (3,693 donors + transactions) and inserts them into Postgres with:
- PAN/email re-encrypted with AES-256-GCM
- Transactions mirrored as paid bookings (so receipts/reports work)
- Deduplication by mobile/PAN and voucherNo (idempotent — safe to re-run)

**Output:** Reports donors created/skipped, transactions created/skipped, bookings created/skipped.

---

## Step 7: Verify the Deployment

1. Visit `https://YOUR_VERCEL_URL.vercel.app`
2. You should be redirected to `/login`
3. Log in with the superadmin username and the password you set in Step 5
4. Check the dashboard — you should see donor/booking stats
5. Navigate to Donors, Bookings, Sevas, Centers, Users, Reports, Events

---

## Vercel Cron (Automatic Session Cleanup)

The `vercel.json` configures an hourly cron job that calls `/api/cron/cleanup` to delete expired sessions. This is authenticated via the `CRON_SECRET` env var — Vercel auto-sends it as a `Authorization: Bearer <CRON_SECRET>` header.

---

## Local Development

```bash
# 1. Create .env with the variables from Step 3
cp .env.example .env
# Fill in the values

# 2. Install dependencies
npm install

# 3. Push schema (first time only)
npm run db:push

# 4. Start dev server
npm run dev
```

The app runs at `http://localhost:3000`.

---

## Security Notes

1. **Secrets in env vars, not source code.** Razorpay keys, password salts, encryption keys — all in Vercel env vars. Never committed to git.
2. **PAN/email encrypted at rest** with AES-256-GCM (not the legacy XOR cipher).
3. **Passwords hashed with bcrypt** (12 rounds). Legacy SHA-256 hashes are transparently rehashed to bcrypt on the first successful login.
4. **SQL injection prevention:** all queries use parameterized tagged templates via the Neon serverless driver. User input is NEVER concatenated.
5. **Permission checks** enforced at the API level (not just the UI) via `lib/permissions.ts`.
6. **Session tokens** are HMAC-signed and stored as SHA-256 hashes (lookup by hash, not by raw token).
7. **The old `Code.gs` is gitignored** and should be deleted from your local copy after you've confirmed the Vercel deployment works and the Razorpay key has been rotated.

---

## File Structure

```
├── app/
│   ├── api/
│   │   ├── [...action]/route.ts   # Main API dispatcher (all 67+ actions)
│   │   └── cron/cleanup/route.ts   # Session cleanup cron
│   ├── dashboard/                  # React frontend screens
│   │   ├── layout.tsx              # Sidebar + auth guard
│   │   ├── page.tsx                # Dashboard home (stats + recent)
│   │   ├── donors/page.tsx
│   │   ├── bookings/page.tsx
│   │   ├── sevas/page.tsx
│   │   ├── centers/page.tsx
│   │   ├── users/page.tsx
│   │   ├── events/page.tsx
│   │   └── reports/page.tsx
│   ├── login/page.tsx              # Login page
│   ├── layout.tsx                  # Root layout (AuthProvider)
│   └── globals.css                 # Tailwind
├── lib/
│   ├── db.ts                       # Neon SQL client (lazy init)
│   ├── db-direct.ts                # Direct connection for migrations
│   ├── env.ts                      # Env validation (zod)
│   ├── crypto.ts                   # AES-256-GCM + legacy decryptor
│   ├── password.ts                 # bcrypt + legacy SHA-256
│   ├── sessions.ts                 # HMAC-signed sessions
│   ├── context.ts                  # Principal resolution
│   ├── permissions.ts              # Center scoping + permission checks
│   ├── audit.ts                    # Audit logging
│   ├── errors.ts                   # ApiError, AuthError, ForbiddenError
│   ├── ids.ts                      # ID generation
│   ├── types.ts                    # Shared domain types
│   ├── client.ts                   # Client-side API caller
│   ├── auth-context.tsx            # React auth context
│   ├── use-all-data.ts             # getAllData React hook
│   └── handlers/                   # Backend action handlers
│       ├── auth.ts                 # login, logout, changePassword, etc.
│       ├── get-all-data.ts         # getAllData (heterogeneous data fetch)
│       ├── crud.ts                 # create/update/delete (all entity types)
│       ├── razorpay.ts             # Razorpay order + payment verification
│       ├── whatsapp.ts             # bhashsms WhatsApp messaging
│       ├── bulk.ts                 # Bulk import (donors, transactions, remarks)
│       ├── events.ts               # Events + event bookings
│       └── misc.ts                 # QR validation, flushSevas, toggle, init
├── db/schema.sql                   # Postgres schema (14+ tables + triggers)
├── scripts/
│   ├── db-push.ts                  # Schema deployment script
│   └── migrate-from-json.ts        # Data migration from JSON export
├── package.json
├── tsconfig.json
├── next.config.mjs
├── postcss.config.mjs
├── vercel.json                     # Cron config
└── .env.example                    # Template for env vars
```

---

## Troubleshooting

### "No database connection string was provided"
→ `DATABASE_URL` is not set. Go to Vercel → Settings → Environment Variables and add it.

### Login fails with "Invalid username or password"
→ You need to call `initializeDatabase` first (Step 5) to set the superadmin password.

### Donors list is empty
→ You need to run `npm run migrate` (Step 6) to import existing data.

### PAN shows as "******" instead of the real number
→ You're logged in as a role that doesn't have `manage_donors` or `donor_logins` permission. PAN is only visible to admins/superadmins.

### Razorpay payments fail
→ Verify `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` are set to the **new** rotated key (Step 0), not the old leaked one.

### Vercel Cron returns 401
→ `CRON_SECRET` in the Vercel dashboard must match what `vercel.json` sends. Vercel auto-injects it; just make sure it's set.
