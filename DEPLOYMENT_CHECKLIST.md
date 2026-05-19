# Pre-Deployment Checklist

## Code Status ✅

- [x] Branch: `agents/code-audit-white-label-optimization`
- [x] Latest commit: `14f67c5b21` - Audio component fixes
- [x] Remote branch: Up-to-date at `origin/agents/code-audit-white-label-optimization`
- [x] Dockerfile: Present and valid (multi-stage build with optimizations)
- [x] docker-compose: Configured in `docker-compose/` directory

## Fixes Included

- [x] **Audio Generation** - react-icons replaced with lucide-react
- [x] **File Uploads** - S3 configuration verified
- [x] **Suno Integration** - Audio API integration complete

## What the Dockerfile Does

1. **Builder stage**: Compiles Next.js app + Vite SPA
2. **Dependencies**: Includes pg, drizzle-orm for database
3. **Optimizations**: Minimal production image (distroless base)
4. **Entry**: Starts Node.js server on port 3210
5. **Environment**: Pre-configured for production deployment

## Next Steps

You must manually SSH into the VPS and run the deployment steps. I cannot execute SSH commands from this environment.

### Quick Copy-Paste Commands

```bash
# SSH connection
ssh root@187.127.156.186

# Once connected, run these commands in sequence:
cd /home/chinnahub
git pull origin agents/code-audit-white-label-optimization
docker build -t chinnahub-app:latest .
docker compose up -d --force-recreate app
docker ps | grep chinnahub
docker compose logs -f app
```

### Estimated Timeline

- **Git pull**: 1-2 minutes (if large repo)
- **Docker build**: 5-10 minutes (network dependent)
- **Container start**: 30-60 seconds
- **App ready**: \~2 minutes from container start (migrations, initialization)

## After Successful Deployment

When deployment is complete and verified:

```sql
UPDATE todos SET status = 'done' WHERE id = 'deploy-vps';
```

## Troubleshooting

If issues occur:

1. **Build fails**: `docker build` output will show the error
2. **Container won't start**: `docker compose logs app` shows why
3. **Database connection**: Verify `DATABASE_URL` in container env
4. **Port issues**: Check if 3210 is open/listening: `netstat -tulpn | grep 3210`

---

**Important**: This deployment includes all audio generation and file upload fixes from the current branch.
