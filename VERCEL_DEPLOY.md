# Vercel Backend Deployment Guide

## Quick Deploy

```powershell
cd c:\Users\jay\Desktop\work\mine\timetable\backend
vercel
```

Follow prompts:
1. Set up and deploy: **Yes**
2. Scope: Choose your account
3. Link to existing project: **No**
4. Project name: **medroster-api**
5. Directory: **./**
6. Override settings: **No**

## Set Environment Variables

After first deployment, add these via Vercel CLI or dashboard:

### Via CLI:
```powershell
vercel env add FIREBASE_ADMIN_PROJECT_ID
# Enter: dev-studio-jay

vercel env add FIREBASE_ADMIN_CLIENT_EMAIL
# Enter: firebase-adminsdk-fbsvc@dev-studio-jay.iam.gserviceaccount.com

vercel env add FIREBASE_ADMIN_PRIVATE_KEY
# Enter: (paste the full private key from backend/.env with \n escapes)

vercel env add ALLOWED_ORIGINS
# Enter: https://your-frontend.vercel.app,http://localhost:3000
```

### Via Dashboard:
1. Go to [vercel.com/dashboard](https://vercel.com/dashboard)
2. Select **medroster-api** project
3. Settings → Environment Variables
4. Add each variable above
5. Select all environments (Production, Preview, Development)

## Deploy Production

```powershell
vercel --prod
```

Your API will be live at: `https://medroster-api.vercel.app`

## Update Frontend

After backend deploys, update [`frontend/.env.local`](frontend/.env.local):

```env
NEXT_PUBLIC_API_URL=https://medroster-api.vercel.app
```

Then deploy frontend:

```powershell
cd c:\Users\jay\Desktop\work\mine\timetable\frontend
vercel --prod
```

## Troubleshooting

### "Module not found" error
- Ensure all dependencies are in `package.json`
- Run `npm install` locally first

### CORS errors
- Add your frontend URL to `ALLOWED_ORIGINS` env variable
- Format: `https://frontend.vercel.app,http://localhost:3000`

### Firebase connection fails
- Verify all three Firebase env vars are set
- Check private key has proper `\n` escaping
- Test locally first: `npm run dev`

### Cold start timeout
- First request may take 1-2 seconds
- Subsequent requests are instant
- This is normal for serverless

## Local Testing

```powershell
cd backend
npm run dev
```

Test at: `http://localhost:4000/health`
