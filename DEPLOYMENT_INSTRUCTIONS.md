# ChinnaHub Deployment Instructions

**Target**: root\@187.127.156.186\
**Branch**: agents/code-audit-white-label-optimization\
**Latest Commit**: 14f67c5b21 (🔧 fix: replace react-icons with lucide-react in audio components)

## Deployment Steps

### 1. SSH to the VPS

```bash
ssh root@187.127.156.186
```

### 2. Navigate to deployment directory

```bash
cd /home/chinnahub
# Or wherever your deployment directory is located
# You may need to check: ls -la /home/
```

### 3. Pull latest code

```bash
git pull origin agents/code-audit-white-label-optimization
```

### 4. Rebuild Docker image

```bash
docker build -t chinnahub-app:latest .
```

**This will:**

- Create Node.js build environment
- Install dependencies (pnpm)
- Build the application (Next.js + Vite SPA)
- Create a minimal production image (\~500MB typically)
- Includes all audio generation and file upload fixes

### 5. Restart containers with the new image

```bash
docker compose up -d --force-recreate app
```

### 6. Monitor the startup

```bash
# Watch the logs in real-time
docker compose logs -f app

# Or check the status
docker ps | grep chinnahub
```

**Wait for messages indicating:**

- ✅ Database migrations completed successfully
- ✅ Server listening on port 3210
- ✅ Health checks passing

### 7. Verify deployment

```bash
# Check container is running
docker ps | grep chinnahub

# Check application is responding
curl -I http://localhost:3210

# Or if exposed externally:
curl -I https://your-domain.com
```

## Key Changes in This Build

1. **Audio Generation Fixes**
   - Replaced react-icons with lucide-react in audio components
   - Fixed Suno integration for stable audio generation

2. **File Upload Improvements**
   - S3 upload configuration verified
   - Upload path handling optimized

3. **Dependencies Updated**
   - All audio generation libraries up-to-date
   - File handling libraries current

## Rollback (if needed)

```bash
# Go back to previous version
git checkout HEAD~1
docker build -t chinnahub-app:previous .
docker compose up -d --force-recreate app
```

## Environment Variables to Verify

Before deploying, ensure these are set in your .env:

- `DATABASE_URL` - PostgreSQL connection
- `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` - File uploads
- `SUNO_API_KEY` - Audio generation
- `AUTH_SECRET` - Authentication
- `APP_URL` - Application URL

## Docker Compose File Location

The deployment uses docker-compose files from: `docker-compose/` directory

- `docker-compose/chinnahub/` - Contains app configuration
- `docker-compose/deploy/` - Contains deployment setup
- `docker-compose/production/` - Contains production setup

## Support

If deployment fails:

1. Check Docker logs: `docker compose logs app`
2. Check disk space: `df -h`
3. Check Docker build errors: Look at the build output above
4. Verify git branch: `git branch -v`
5. Check permissions: `ls -la /home/chinnahub`

---

**Version**: agents/code-audit-white-label-optimization\
**Image**: chinnahub-app:latest\
**Time to build**: \~5-10 minutes (depending on network/server specs)\
**Time to start**: \~30-60 seconds
