# Vercel Backend Deployment Guide

See the full guide: [../VERCEL_SETUP.md](../VERCEL_SETUP.md)

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
- `FIREBASE_ADMIN_PRIVATE_KEY`
- `ALLOWED_ORIGINS` — e.g. `https://medroster-frontend.vercel.app,http://localhost:3000`

## GitHub Actions

Workflow: [`.github/workflows/deploy-backend.yml`](.github/workflows/deploy-backend.yml)

Secrets required in the **backend** GitHub repo:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

## Local

```bash
npm run dev
```

Health: [http://localhost:4000/health](http://localhost:4000/health)
