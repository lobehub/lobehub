import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import dotenv from 'dotenv';

import { uploadAssets } from '../../../scripts/mobileSpaWorkflow/upload';

const workbenchRoot = resolve(__dirname, '..');
const repoRoot = resolve(workbenchRoot, '../..');
const assetsDir = resolve(workbenchRoot, 'build/client/assets');

dotenv.config({ path: resolve(repoRoot, '.env') });

const firstEnv = (...names: string[]) => {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return undefined;
};

const requireEnv = (...names: string[]): string => {
  const value = firstEnv(...names);
  if (!value) throw new Error(`Missing env: ${names.join(' / ')}`);
  return value;
};

async function main() {
  const publicDomain = new URL(requireEnv('ASSET_S3_PUBLIC_DOMAIN', 'MOBILE_S3_PUBLIC_DOMAIN'))
    .origin;
  // Same convention as cloud's resolveViteBase: a stable entry suffix, no version
  // stamp — content-hashed filenames make uploads incremental and cache-immutable.
  const keyPrefix = (
    firstEnv('ASSET_S3_KEY_PREFIX', 'WORKBENCH_S3_KEY_PREFIX') || 'workbench'
  ).replaceAll(/^\/+|\/+$/g, '');
  const cdnBase = `${publicDomain}/${keyPrefix}/`;

  console.log(`=== Step 1: Build workbench (VITE_CDN_BASE=${cdnBase}) ===`);
  execSync('bun run build:rr', {
    cwd: workbenchRoot,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      NODE_OPTIONS: '--max-old-space-size=8192',
      VITE_CDN_BASE: cdnBase,
    },
    stdio: 'inherit',
  });

  if (!existsSync(assetsDir)) throw new Error(`Build output not found at ${assetsDir}`);

  console.log('\n=== Step 2: Upload assets to S3 ===');
  await uploadAssets(assetsDir, {
    accessKeyId: requireEnv('ASSET_S3_ACCESS_KEY_ID', 'MOBILE_S3_ACCESS_KEY_ID'),
    bucket: requireEnv('ASSET_S3_BUCKET', 'MOBILE_S3_BUCKET'),
    endpoint: requireEnv('ASSET_S3_ENDPOINT', 'MOBILE_S3_ENDPOINT'),
    keyPrefix,
    publicDomain,
    region: firstEnv('ASSET_S3_REGION', 'MOBILE_S3_REGION') || 'auto',
    secretAccessKey: requireEnv('ASSET_S3_SECRET_ACCESS_KEY', 'MOBILE_S3_SECRET_ACCESS_KEY'),
  });

  console.log('\n=== Step 3: Deploy worker ===');
  execSync('node_modules/.bin/wrangler deploy --config build/server/wrangler.json', {
    cwd: workbenchRoot,
    stdio: 'inherit',
  });

  console.log('\n=== Deploy complete ===');
}

main().catch((error) => {
  console.error('Deploy failed:', error);
  process.exit(1);
});
