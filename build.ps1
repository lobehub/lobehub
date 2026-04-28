Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Write-Host "Step 1: Install dependencies..."
pnpm install

Write-Host "Step 2: Run database migration..."
pnpm run db:migrate

Write-Host "Step 3: Build Vite SPA..."
Remove-Item -Recurse -Force public/_spa -ErrorAction SilentlyContinue
pnpm exec vite build

Write-Host "Step 4: Generate SPA HTML templates..."
pnpm exec tsx scripts/copySpaBuild.mts
pnpm exec tsx scripts/generateSpaTemplates.mts

Write-Host "Step 5: Build Next.js..."
pnpm exec next build

Write-Host "Build complete! Run: pnpm exec next start --port 3010"
