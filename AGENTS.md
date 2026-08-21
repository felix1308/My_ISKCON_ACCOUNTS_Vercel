# MyISKCON Accounts — Project Guide

## Build & Dev Commands
- `npm run dev` — start local dev server (port 3000)
- `npm run build` — production build
- `npm run typecheck` — TypeScript type checking (no emit)
- `npm run db:push` — apply `db/schema.sql` to Postgres (needs DATABASE_URL_DIRECT in .env)
- `npm run migrate` — import donors + transactions from `scripts/donors_with_transactions.json`

## Architecture
- **Frontend:** Next.js 16 App Router, TypeScript, Tailwind CSS 4
- **Backend:** Next.js API routes at `/api/rpc` (single dispatcher, 67+ actions)
- **Database:** Neon Postgres (via `@neondatabase/serverless`), 14+ tables in `db/schema.sql`
- **Auth:** bcrypt (modern) + legacy SHA-256 (backward-compat, rehash on login), HMAC-signed sessions
- **Encryption:** AES-256-GCM for PAN/email/gateway secrets at rest
- **Payments:** Razorpay (server-side order creation + HMAC-SHA256 payment verification)
- **WhatsApp:** bhashsms.com API (env-var credentials)
- **Cron:** Vercel Cron daily session cleanup at `/api/cron/cleanup` (daily is the max on the Hobby plan)

## Payment Routing (decided Aug 2026)
Gateway resolution: explicit `paymentGatewayId` → center's bank account link → env `RAZORPAY_KEY_ID` fallback (= RP ICC General).
- Bangalore → RP ICC General; Tumkur / Koramangala / Electronic City → RP ICC Bhakti Kuteers
- Kalaburgi / IYF / RRN / Begur → intentionally on env fallback (ICC General), no per-center routing wanted
- `ICC_Project` and `Matchless_Gifts` gateways exist in DB but are intentionally unused — do not link or flag them

## Key Files
- `lib/handlers/` — all backend action handlers (auth, crud, razorpay, whatsapp, bulk, events, misc)
- `lib/permissions.ts` — center-scoped permission checks
- `lib/context.ts` — principal resolution from session token
- `app/api/[...action]/route.ts` — API dispatcher
- `db/schema.sql` — Postgres schema (run via `npm run db:push`)

## Security
- All secrets in env vars (never in source). See `.env.example` for the full list.
- All SQL is parameterized via Neon tagged templates — never concatenate user input.
- `Code.gs` and `myiskcon.html` are gitignored (they contain a hardcoded Razorpay key; owner has confirmed the files were never shared — rotate only if they ever get shared or committed).
- See `VERCEL_DEPLOYMENT.md` for step-by-step deployment.
