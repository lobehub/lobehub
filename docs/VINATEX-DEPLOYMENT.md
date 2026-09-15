# Vinatex Production Deployment - LobeHub

## Architecture
- Application: Vercel
- Database: External PostgreSQL 16+ with pgvector
- Object storage: Private S3-compatible storage (Cloudflare R2 or MinIO via HTTPS)
- AI providers: Vinatex AI Router via OpenAI-compatible endpoint

## Required Vercel Environment Variables
APP_URL
AUTH_SECRET
KEY_VAULTS_SECRET
DATABASE_URL
S3_ACCESS_KEY_ID
S3_SECRET_ACCESS_KEY
S3_BUCKET
S3_ENDPOINT
S3_REGION

## Security
Never commit production secrets. Configure them in Vercel Environment Variables.
