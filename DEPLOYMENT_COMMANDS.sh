#!/bin/bash
# ChinnaHub Deployment Commands
# Target: root@187.127.156.186
# Branch: agents/code-audit-white-label-optimization

echo "=========================================="
echo "ChinnaHub Deployment Script"
echo "=========================================="
echo ""
echo "This script must be run on the VPS at root@187.127.156.186"
echo "Copy each section and run in sequence"
echo ""

# Step 1
echo "STEP 1: Navigate to deployment directory"
echo "=========================================="
echo 'cd /home/chinnahub'
echo ''

# Step 2
echo "STEP 2: Pull latest code"
echo "=========================================="
echo 'git pull origin agents/code-audit-white-label-optimization'
echo ''

# Step 3
echo "STEP 3: Build Docker image"
echo "=========================================="
echo 'docker build -t chinnahub-app:latest .'
echo 'echo "Build complete at: $(date)"'
echo ''

# Step 4
echo "STEP 4: Restart containers"
echo "=========================================="
echo 'docker compose up -d --force-recreate app'
echo ''

# Step 5
echo "STEP 5: Wait for startup and verify"
echo "=========================================="
echo 'sleep 10'
echo 'docker ps | grep chinnahub'
echo ''

# Step 6
echo "STEP 6: Monitor logs (press Ctrl+C to exit)"
echo "=========================================="
echo 'docker compose logs -f app'
echo ''

# Success
echo "=========================================="
echo "If you see 'Server listening on port 3210',"
echo "then deployment is successful!"
echo "=========================================="
echo ""
