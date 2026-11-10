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

For local OTP testing, keep `NODE_ENV=development`, `OTP_PROVIDER=console`, and `OTP_DEBUG_RETURN=true` in `.env`. Send `POST /api/v1/auth/otp/request` with `{"phone":"<your test phone>"}`; the response includes `data.dev_otp`, which you can submit to `POST /api/v1/auth/otp/verify`. The random OTP is stored in the database as a hash, not plaintext. Console delivery and debug responses are disabled in production; the OTP request endpoint returns `503` until an SMS provider is configured there.

The Firebase Admin SDK requires Node.js 22 or newer; use Node.js 22.x or newer locally and in Vercel.

## Auth APIs (base `/api/v1/auth`)

| Method | Path | Who | What |
|---|---|---|---|
| POST | `/firebase/verify` | public | verify a Firebase Phone Auth ID token and return Pehra tokens |
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

## Society admin APIs (base `/api/v1`)

All endpoints below require an active admin token. Society scope is taken from the token; resource IDs from another society return 404. List responses are paginated with `page` (default 1) and `limit` (default 20, maximum 100).

| Method | Path | Purpose |
|---|---|---|
| GET | `/society` | Get society settings and tower, flat, resident, request, and guard counts |
| PATCH | `/society` | Update society details and policy settings |
| POST | `/society/invite-code/rotate` | Rotate the society join code |
| GET | `/towers` | List towers with flat counts |
| POST | `/towers` | Create a tower |
| PATCH | `/towers/:id` | Rename a tower or update its floor count |
| DELETE | `/towers/:id` | Delete a tower with no flats |
| POST | `/towers/:id/flats/generate` | Generate numbered flats for selected floors |
| GET | `/flats` | Search and list flats with resident counts and head names |
| POST | `/flats` | Create a flat in a tower |
| PATCH | `/flats/:id` | Change a flat's floor or number |
| DELETE | `/flats/:id` | Delete a flat with no resident or visit history |
| POST | `/flats/:flatId/family` | Register one to fifteen residents for a flat |
| GET | `/gates` | List gates with active device counts |
| POST | `/gates` | Create a gate |
| PATCH | `/gates/:id` | Rename or activate/deactivate a gate |
| GET | `/residents` | Search and list residents by flat or status |
| GET | `/residents/:id` | Get a resident's details |
| PATCH | `/residents/:id` | Edit an active resident or change the flat head |
| POST | `/residents/:id/move-out` | Mark an active resident as moved out |
| GET | `/join-requests` | List pending or declined resident requests |
| POST | `/join-requests/:id/approve` | Approve a pending join request |
| POST | `/join-requests/:id/decline` | Decline a pending join request with a reason |

Tower flat-generation bodies use `{ "floors_to": 4, "flats_per_floor": 2 }`. Family registration uses `{ "members": [...] }`; a member's optional `phone` is normalized to E.164 and `photo_path` is a storage object key, not a URL.

How the three roles are found: nobody picks a role. The admin adds guards/residents by phone first; when that phone logs in with OTP, the API matches it and returns the roles (`profiles`). `is_new_user: true` means no role yet, so the app shows "Create society" or "Join society".

Responses: `{ "success": true, "message": "...", "data": {...} }` or `{ "success": false, "message": "..." }`.
Send `Authorization: Bearer <access_token>` on protected routes.

### Firebase Phone Auth

The Flutter app completes Firebase Phone Auth, obtains the Firebase ID token for the signed-in user, and sends it to `POST /api/v1/auth/firebase/verify` as JSON: `{ "id_token": "<Firebase ID token>" }`. The API verifies the token for `FIREBASE_PROJECT_ID`, requires the Firebase phone sign-in provider and a verified phone number, then uses that phone to load/link Pehra profiles and issue the existing Pehra access and refresh tokens. Use those Pehra tokens for subsequent API calls.

Set `FIREBASE_PROJECT_ID=pehra-fbcbd` and configure a Firebase service-account credential on the backend. For local development, set `FIREBASE_SERVICE_ACCOUNT_PATH` to a private service-account JSON file; matching service-account filenames are git-ignored. On Vercel, add the complete service-account JSON as `FIREBASE_SERVICE_ACCOUNT_JSON`—never commit or share the private key. Set the environment variables for the Vercel environments you use and redeploy after changing them.

To create the credential, open Firebase Console → **Project settings** → **Service accounts** → **Generate new private key**. Store the downloaded file privately. For local development, set `FIREBASE_SERVICE_ACCOUNT_PATH` in `.env` to that file's path. For Vercel, paste the complete JSON file contents into the `FIREBASE_SERVICE_ACCOUNT_JSON` environment variable. Do not send this key in chat or commit it to GitHub.

## Deploy to Vercel

1. Push this project to GitHub. Do not commit `.env`; it is git-ignored. If the project is inside a larger repository, note its folder so you can select it as the Vercel Root Directory.
2. In Vercel, choose **Add New > Project**, import the repository, and set **Framework Preset** to **Other**. Set the Root Directory to this project folder if needed. Leave the Build Command and Output Directory empty; Vercel runs `api/index.js` as a serverless function using `vercel.json`.
3. In **Project Settings > Environment Variables**, add these for the **Production** environment:
   - `DATABASE_URL`: the Supabase **Transaction pooler** connection string (port `6543`).
   - `DB_SSL`: `true`
   - `DB_POOL_MAX`: `3` (optional; keep the pool small for serverless)
   - `JWT_SECRET`: a unique random secret; generate one locally with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
   - `FIREBASE_PROJECT_ID`: `pehra-fbcbd`.
   - `FIREBASE_SERVICE_ACCOUNT_JSON`: the complete Firebase service-account JSON credential. Do not use a client configuration file such as `google-services.json`.
   - `NODE_ENV`: `production`
   - Do not set `OTP_PROVIDER=console` in Production. Configure a real SMS provider before enabling OTP sign-in.
   - `OTP_DEBUG_RETURN`: `false` (or omit it). Production never returns debug OTPs.
4. Make sure the Supabase database schema/tables are already created, then click **Deploy**. After deployment, open `https://<your-project>.vercel.app/api/v1/health`; a successful response confirms the API is live.
5. In Postman, set the collection variable `base_url` to `https://<your-project>.vercel.app`.

You can also deploy from this folder with the Vercel CLI: run `vercel` to link the project and create a preview deployment, then `vercel --prod` to deploy to production. Add the same environment variables in the Vercel dashboard before deploying.

**OTP limitation:** this project does not yet integrate an SMS provider. Use the console OTP provider only for local development. Production OTP requests are rejected until SMS delivery is implemented and configured; never expose OTPs through production responses or logs.

## Test in Postman

Import `postman/pehra-auth.postman_collection.json`. Run "Request OTP" then "Verify OTP" (the OTP and tokens fill themselves). Change the `phone` variable to try each role (demo data): admin `9000000001`, guard `9000000002`, unpaired guard `9000000006`, resident `9000000003`. Any other phone is a new person.

## Automated check

    DATABASE_URL=... DB_SSL=false JWT_SECRET=x npm test

Runs the auth flow and then the society-admin API flow against a development database loaded with the schema and demo data. The admin flow creates development test records and restores the demo society invite code; do not run against production.

## Known limits (next steps)
- Background jobs (alert escalation, photo purge, keep-alive) cannot run inside Vercel functions; they will use Vercel Cron or a small always-on worker.
- Pairing-code attempts are limited per IP only; add per-user lockout later.
