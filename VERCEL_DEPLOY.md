# Vercel Backend Deployment Guide

See the full guide: [../VERCEL_SETUP.md](../VERCEL_SETUP.md)

**Production:** [https://medroster-backend.vercel.app](https://medroster-backend.vercel.app) — Vercel team `dev-studio-jay`, project `medroster-backend`.

## Quick deploy

```bash
cd backend
vercel
vercel --prod
```

## Required environment variables

Set in the Vercel project (Production / Preview / Development):

- `FIREBASE_ADMIN_PROJECT_ID`
- `FIREBASE_ADMIN_CLIENT_EMAIL`
- `FIREBASE_ADMIN_PRIVATE_KEY` — paste the PEM as one line with `\n` for breaks, e.g. `"-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n"`. Do not paste real multiline breaks unless Vercel keeps them as `\n`.
- `ALLOWED_ORIGINS` — e.g. `https://medroster-frontend.vercel.app,http://localhost:3000`
- `OPENAI_API_KEY` — optional; used to clean duty-roster Word extracts

## Git → production

Repo [`dev-studio-jay/MedRoster-Backend-API`](https://github.com/dev-studio-jay/MedRoster-Backend-API) is connected to Vercel project `medroster-backend`.

- Push to **`main`** → production [https://medroster-backend.vercel.app](https://medroster-backend.vercel.app)
- Other branches → preview deployments

Optional GitHub Actions backup: [`.github/workflows/deploy-backend.yml`](.github/workflows/deploy-backend.yml) (`workflow_dispatch`). Needs `VERCEL_TOKEN` from [Vercel account tokens](https://vercel.com/account/tokens), plus `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID`.

## Local

```bash
npm run dev
```

Health: [http://localhost:4000/health](http://localhost:4000/health)
