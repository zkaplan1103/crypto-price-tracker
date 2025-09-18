# Render Deployment Guide

Deploy both frontend and backend to Render for free hosting that's perfect for your portfolio.

## Prerequisites
- GitHub repository with your crypto tracker
- Render account (free at render.com)

## Step-by-Step Deployment

### 1. Create Render Account
1. Go to [render.com](https://render.com)
2. Sign up with your GitHub account
3. Authorize Render to access your repositories

### 2. Deploy the Backend
1. In Render dashboard, click **"New +"** → **"Web Service"**
2. Connect your GitHub repository
3. Configure:
   - **Name**: `crypto-tracker-backend`
   - **Language**: Select `Docker` (not Node)
   - **Branch**: `main`
   - **Region**: `Oregon (US West)`
   - **Root Directory**: Leave empty (uses project root)
   - **Build Command**: Leave as `pnpm install --frozen-lockfile; pnpm run build` 
   - **Start Command**: Leave empty (Docker handles this)
4. **Environment Variables**: 
   - `NODE_ENV` = `production`
5. Click **"Create Web Service"**

### 3. Deploy the Frontend
1. Click **"New +"** → **"Web Service"** again
2. Connect same repository
3. Configure:
   - **Name**: `crypto-tracker-frontend`
   - **Language**: `Node`
   - **Branch**: `main`
   - **Region**: `Oregon (US West)`
   - **Root Directory**: `frontend`
   - **Build Command**: `npm install -g pnpm && pnpm install && pnpm run proto:generate && pnpm run build`
   - **Start Command**: `pnpm start`
4. **Environment Variables**:
   - `NODE_ENV` = `production`
   - `NEXT_PUBLIC_API_URL` = `https://crypto-tracker-backend.onrender.com` (use your actual backend URL)
5. Click **"Create Web Service"**

**If build fails with protobuf errors:**
- Go to your frontend service settings
- Update the **Build Command** to: `npm install -g pnpm && pnpm install && pnpm run proto:generate && pnpm run build`
- Click **"Manual Deploy"** to retry with the updated command

### 4. Get Your URLs
After deployment completes:
- **Backend**: `https://crypto-tracker-backend.onrender.com`
- **Frontend**: `https://crypto-tracker-frontend.onrender.com` 

### 5. Update Frontend Environment
1. Go to your frontend service in Render
2. Click **"Environment"**  
3. Update `NEXT_PUBLIC_API_URL` with your actual backend URL
4. Click **"Save Changes"** (triggers redeploy)

## Free Tier Limits
- **750 hours/month** per service (enough for portfolio projects)
- **512MB RAM** per service
- Apps **sleep after 15min** of inactivity (normal for free tier)
- **Cold starts** take ~30 seconds to wake up

## Testing Your Deployment
1. Visit your frontend URL
2. Add a ticker (e.g., "BTCUSD")
3. Verify real-time price updates work
4. Check browser console for errors

## Troubleshooting

### Backend Issues
- Check **"Logs"** tab in Render dashboard
- Ensure Dockerfile builds correctly
- Verify protobuf generation worked

### Frontend Issues  
- Check `NEXT_PUBLIC_API_URL` environment variable
- Ensure it points to your backend URL
- Check WebSocket connection in browser console

### Cold Starts
- Free tier apps sleep after 15min inactivity
- First request after sleep takes ~30 seconds
- This is normal for free hosting

## Portfolio Integration
- Use your frontend URL as the demo link
- Perfect for showcasing real-time functionality
- Professional appearance with no browser popups
- Reliable free hosting for interviews/presentations

## Render vs Railway vs Netlify
✅ **Render Advantages**:
- Actually free (750 hours/month)
- Simple setup
- Both services on one platform
- Good documentation

❌ **Railway**: Only 30-day trial
❌ **Netlify**: Can't handle WebSocket backend

## Next Steps
1. Deploy following this guide
2. Test thoroughly
3. Add the frontend URL to your portfolio
4. Consider upgrading to paid tier if you need zero cold starts