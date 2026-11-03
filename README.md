# Pehra API

Node.js + Express API for Pehra. Talks to the Supabase Postgres database (tables already created from `1_create_tables.sql`).

## Folder map (one direction only)

    route -> middleware -> controller -> service -> db

| Folder | What it does |
|---|---|
| `src/routes` | URL + method + which middlewares + which controller. No logic. |
| `src/middlewares` | authenticate (JWT), authorizeRole, validate (zod), rate limits, errors |
| `src/controllers` | read request, call a service, send response |
| `src/services` | all logic and SQL |
| `src/validators` | zod rules for request bodies |
| `src/db` | connection pool + `query()` / `transaction()` helpers only |
| `src/config`, `src/utils` | env, constants, small helpers |
| `api/index.js`, `vercel.json` | how Vercel runs the app |

## Run locally

    npm install
    cp .env.example .env      # fill DATABASE_URL and JWT_SECRET
    npm run dev               # http://localhost:4000/api/v1/health

## Auth APIs (base `/api/v1/auth`)

| Method | Path | Who | What |
|---|---|---|---|
| POST | `/otp/request` | public | send OTP to phone |
| POST | `/otp/verify` | public | verify OTP, returns access + refresh token, `is_new_user`, `profiles` |
| POST | `/refresh` | public | new tokens (old refresh token stops working) |
| POST | `/logout` | public | end session |
| GET | `/me` | logged in | user + roles |
| POST | `/switch-role` | logged in | same phone, other role/society |
| POST | `/admin/register-society` | new person | creates society + Main Gate, caller becomes admin, returns invite code |
| POST | `/resident/join` | new person | society code + flat -> pending request for admin |
| POST | `/guard/pairing-codes` | admin | 6-digit code for a gate (10 min) |
| POST | `/guard/pair` | guard | enter the code, phone is tied to the gate, new token carries `gate_id` |

How the three roles are found: nobody picks a role. The admin adds guards/residents by phone first; when that phone logs in with OTP, the API matches it and returns the roles (`profiles`). `is_new_user: true` means no role yet, so the app shows "Create society" or "Join society".

Responses: `{ "success": true, "message": "...", "data": {...} }` or `{ "success": false, "message": "..." }`.
Send `Authorization: Bearer <access_token>` on protected routes.

## Deploy to Vercel

1. Push this project to GitHub. Do not commit `.env`; it is git-ignored. If the project is inside a larger repository, note its folder so you can select it as the Vercel Root Directory.
2. In Vercel, choose **Add New > Project**, import the repository, and set **Framework Preset** to **Other**. Set the Root Directory to this project folder if needed. Leave the Build Command and Output Directory empty; Vercel runs `api/index.js` as a serverless function using `vercel.json`.
3. In **Project Settings > Environment Variables**, add these for the **Production** environment:
   - `DATABASE_URL`: the Supabase **Transaction pooler** connection string (port `6543`).
   - `DB_SSL`: `true`
   - `DB_POOL_MAX`: `3` (optional; keep the pool small for serverless)
   - `JWT_SECRET`: a unique random secret; generate one locally with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
   - `NODE_ENV`: `production`
   - `OTP_PROVIDER`: `console` only for temporary testing.
   - `OTP_DEBUG_RETURN`: `false` (or omit it). Never enable debug OTP responses in production.
4. Make sure the Supabase database schema/tables are already created, then click **Deploy**. After deployment, open `https://<your-project>.vercel.app/api/v1/health`; a successful response confirms the API is live.
5. In Postman, set the collection variable `base_url` to `https://<your-project>.vercel.app`.

You can also deploy from this folder with the Vercel CLI: run `vercel` to link the project and create a preview deployment, then `vercel --prod` to deploy to production. Add the same environment variables in the Vercel dashboard before deploying.

**OTP limitation:** this project does not yet integrate an SMS provider. `OTP_PROVIDER=console` writes OTPs to function logs; with `OTP_DEBUG_RETURN=false`, the API does not return the OTP to callers. This is suitable only for temporary deployment/health checks, not real user sign-in. Implement and configure an SMS provider in `src/services/otp.service.js` before using authentication with real users; never expose OTPs through production responses or logs.

## Test in Postman

Import `postman/pehra-auth.postman_collection.json`. Run "Request OTP" then "Verify OTP" (the OTP and tokens fill themselves). Change the `phone` variable to try each role (demo data): admin `9000000001`, guard `9000000002`, unpaired guard `9000000006`, resident `9000000003`. Any other phone is a new person.

## Automated check

    DATABASE_URL=... DB_SSL=false JWT_SECRET=x npm test

Runs the whole flow (login for all roles, pairing, refresh, society creation, join) against a database that has the demo data. Do not run against production.

## Known limits (next steps)
- Background jobs (alert escalation, photo purge, keep-alive) cannot run inside Vercel functions; they will use Vercel Cron or a small always-on worker.
- Pairing-code attempts are limited per IP only; add per-user lockout later.
