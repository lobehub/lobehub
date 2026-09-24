/**
 * Publish the review toolbar to the asset CDN, beside the workbench:
 *   <ASSET_S3_PUBLIC_DOMAIN>/review-sdk/assets/v1/lobehub-review.js
 * The major version is in the path, so a breaking release ships next to v1.
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import dotenv from 'dotenv';

import { uploadAssets } from '../../../scripts/mobileSpaWorkflow/upload';

const sdkRoot = resolve(__dirname, '..');
const repoRoot = resolve(sdkRoot, '../..');
const distDir = resolve(sdkRoot, 'dist');

dotenv.config({ path: resolve(repoRoot, '.env') });

const firstEnv = (...names: string[]) => names.map((name) => process.env[name]).find(Boolean);
const requireEnv = (...names: string[]) => {
  const value = firstEnv(...names);
  if (!value) throw new Error(`Missing env: ${names.join(' / ')}`);
  return value;
};

async function main() {
  console.log('=== Step 1: Build review SDK ===');
  execSync('bun run build', {
    cwd: sdkRoot,
    env: { ...process.env, NODE_ENV: 'production' },
    stdio: 'inherit',
  });
  if (!existsSync(distDir)) throw new Error(`Build output not found at ${distDir}`);

  console.log('\n=== Step 2: Upload to the asset CDN ===');
  await uploadAssets(distDir, {
    accessKeyId: requireEnv('ASSET_S3_ACCESS_KEY_ID', 'MOBILE_S3_ACCESS_KEY_ID'),
    bucket: requireEnv('ASSET_S3_BUCKET', 'MOBILE_S3_BUCKET'),
    endpoint: requireEnv('ASSET_S3_ENDPOINT', 'MOBILE_S3_ENDPOINT'),
    keyPrefix: 'review-sdk',
    publicDomain: new URL(requireEnv('ASSET_S3_PUBLIC_DOMAIN', 'MOBILE_S3_PUBLIC_DOMAIN')).origin,
    region: firstEnv('ASSET_S3_REGION', 'MOBILE_S3_REGION') || 'auto',
    secretAccessKey: requireEnv('ASSET_S3_SECRET_ACCESS_KEY', 'MOBILE_S3_SECRET_ACCESS_KEY'),
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
