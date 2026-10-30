# Career Match — engineering guide

A production-shaped job-matching application: React 18 SPA, Fastify 5 API, PostgreSQL + Prisma, keyless public job feeds, local resume parsing, and explainable recommendations. It began as the Fusion Starter template and now contains the full Career Match product.

## Tech stack

- **Package manager:** pnpm
- **Frontend:** React 18, React Router 6 (SPA), TypeScript, Vite 8, Tailwind CSS 4, Radix UI, Lucide icons
- **Backend:** Fastify 5, Zod validation, Prisma 6, PostgreSQL
- **Auth:** short-lived JWT access cookie + rotating opaque refresh cookie (`cm_access`, `cm_refresh`)
- **Resume parsing:** `unpdf` (PDF) and `mammoth` (DOCX) in Node; optional Python ML service
- **Matching:** skills, experience, preferences, and in-process TF-IDF cosine similarity
- **Tests:** Vitest

## Project structure

```
client/
├── pages/                 # Route components (Index = home)
├── components/            # Shared UI (JobCard, HeaderMenus, ScoreRing, etc.)
├── components/ui/         # Radix-based primitives
├── context/AuthContext.tsx
├── lib/                   # api client, types, formatting
├── App.tsx                # Routes, header, footer, lazy loading
└── global.css             # Theme tokens and component classes

server/
├── index.ts               # Fastify setup, plugins, Swagger, auto feed warmup
├── node-build.ts          # `pnpm start` entry (API only)
├── routes/api.ts          # All REST routes under /api/v1
├── lib/                   # auth, prisma client, matching, text, skills
└── services/              # job import, resume parser, resume storage, ML client

prisma/                    # schema + migrations
scripts/                   # jobs:sync and demo:seed
api/[...path].ts           # Vercel serverless adapter
ml-service/                # optional Python NLP service
```

## Commands

```bash
pnpm dev            # Vite + Fastify on http://localhost:8080
pnpm build          # prisma generate + typecheck + SPA build
pnpm start          # API-only production-like server
pnpm typecheck
pnpm test
pnpm db:migrate     # prisma migrate deploy
pnpm db:generate
pnpm jobs:sync      # import enabled feeds; Adzuna/Jooble activate when their keys are set
pnpm demo:seed      # optional local demo accounts and listings
```

## API conventions

- All routes live under `/api/v1`; success responses use `{ data, meta? }`, errors use `{ error: { code, message, details? } }`.
- `authenticate` and `requireRole(...)` from `server/lib/auth.ts` guard routes.
- Zod parses bodies/queries at the top of each handler; the global error handler converts `ZodError` into a 400.
- Keep candidate actions scoped to `request.user.sub`; recruiter actions must verify ownership of the job/application.
- Public job data uses `server/services/job-import.ts`. Every external listing must keep `sourceName`, `sourceJobId`, and an `applyUrl` back to the original post.
- Jobs imported from public feeds belong to the `JOB_IMPORT_EMAIL` account and use `source: "EXTERNAL"`.
- Heavy endpoints use `relationLoadStrategy: "join"` and `Promise.all` for independent queries; transactions that touch several rows set an explicit `timeout`.
- Resume parsing must work without the Python service. `parseResumeBuffer` tries the optional service and falls back to the local rule-based parser.

## Frontend conventions

- Pages are lazy-loaded in `client/App.tsx`; add new routes above the catch-all.
- Use `api<T>()` from `client/lib/api.ts` (handles cookies, JSON, refresh, and `{ data }` unwrapping expectations).
- Reuse `JobCard`, `CompanyLogo`, `ScoreRing`, `Progress`, `Pagination`, and `EmptyState` for visual consistency.
- Loading states should be explicit; never show a misleading `0` while data is still in flight.
- Tailwind design tokens: `ink`, `paper`, `coral`, `secondary`, `card`. Component classes live in `client/global.css`.
- The visual language is editorial: Manrope display headings, DM Sans body, warm paper background, coral accent, subtle borders.

## Data and matching notes

- `Job.searchText` stores the first 3,000 characters of the description for fast ranking without loading full descriptions.
- Recommendation scores are relative fit, not hiring probability. Match explanations list matched and missing skills.
- Public feeds are refreshed when the newest `Job.updatedAt` is older than `JOB_SYNC_INTERVAL_HOURS` (default 6). `JOB_SYNC_ENABLED=false` disables this.
- Public feeds require attribution in the UI; keep source names and links visible.
- Resume files default to PostgreSQL storage in production and local private storage in development.

## Optional keys and services

No key is needed for the core product. Optional integrations:

- `GOOGLE_CLIENT_ID` + `VITE_GOOGLE_CLIENT_ID` — Google sign-in. Add `http://localhost:8080` and the deployed origin to **Authorized JavaScript origins**.
- `ADZUNA_APP_ID` + `ADZUNA_APP_KEY` — India-focused listings via Adzuna (`JOB_IMPORT_COUNTRY`, default `in`).
- `JOOBLE_API_KEY` — India-focused listings via Jooble (`JOB_IMPORT_LOCATION`, default `India`).
- `BREVO_API_KEY` — email without a domain; verify a single sender address and set `EMAIL_FROM` to it.
- `RESEND_API_KEY` — email with a verified domain (without one it only delivers to the Resend account owner). Without any transport, reset links only appear in development and production logs a delivery error.
- `ML_SERVICE_URL` — self-hosted Python NLP service; purely an enhancement.
- `RESUME_S3_*` / AWS variables — S3-compatible resume storage.
- `ADMIN_BOOTSTRAP_SECRET` — one-time admin promotion endpoint.

## Deployment

- `pnpm build` outputs the SPA to `dist/spa`.
- Vercel: `vercel.json` uses `handle: filesystem` then an SPA fallback, so `/api/*` reaches the Fastify function in `api/[...path].ts`.
- Set `DATABASE_URL`, `ACCESS_TOKEN_SECRET` (32+ chars), and `FRONTEND_ORIGIN` in the host environment. Set `BREVO_API_KEY` or `RESEND_API_KEY` plus `EMAIL_FROM` before launch so password reset can deliver mail. Apply Prisma migrations before the first request.
- Run `pnpm jobs:sync` once during/after deployment, or call `POST /api/v1/admin/jobs/sync` from an admin account.
