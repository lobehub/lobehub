import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import dotenv from 'dotenv';

import { generateMobileTemplate } from './template';
import { uploadAssets } from './upload';

dotenv.config();

const root = resolve(__dirname, '../..');
const distDir = resolve(root, 'dist/mobile');
const assetsDir = resolve(distDir, 'assets');

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function main() {
  const publicDomain = new URL(requireEnv('MOBILE_S3_PUBLIC_DOMAIN')).origin;
  const timestamp = new Date().toISOString().replaceAll(/[-:]/g, '').replace('T', '-').slice(0, 15); // e.g. 20260226-153012
  const keyPrefix = (process.env.MOBILE_S3_KEY_PREFIX || `mobile/${timestamp}`).replaceAll(
    /^\/+|\/+$/g,
    '',
  );

  // VITE_CDN_BASE = domain + optional key prefix, e.g. https://web-assets.lobehub.com/mobile/20260226-153012/
  const cdnBase = `${publicDomain.replace(/\/+$/, '')}/${keyPrefix}/`;

  // Step 1: Build mobile SPA with CDN base
  console.log('=== Step 1: Building mobile SPA ===');
  execSync('vite build', {
    cwd: root,
    env: {
      ...process.env,
      MOBILE: 'true',
      NODE_OPTIONS: '--max-old-space-size=8192',
      VITE_CDN_BASE: cdnBase,
    },
    stdio: 'inherit',
  });

  if (!existsSync(assetsDir)) {
    throw new Error(`Build output not found at ${assetsDir}`);
  }

  // Step 2: Upload assets to S3
  console.log('\n=== Step 2: Uploading assets to S3 ===');
  await uploadAssets(assetsDir, {
    accessKeyId: requireEnv('MOBILE_S3_ACCESS_KEY_ID'),
    bucket: requireEnv('MOBILE_S3_BUCKET'),
    endpoint: requireEnv('MOBILE_S3_ENDPOINT'),
    keyPrefix: keyPrefix.replaceAll(/^\/+|\/+$/g, ''),
    publicDomain,
    region: process.env.MOBILE_S3_REGION || 'auto',
    secretAccessKey: requireEnv('MOBILE_S3_SECRET_ACCESS_KEY'),
  });

  // Step 3: Generate mobile HTML template source file
  console.log('\n=== Step 3: Generating mobile template ===');
  generateMobileTemplate(distDir);

  console.log('\n=== Workflow complete ===');
  console.log('Remember to commit mobileHtmlTemplate.source.ts to the repository.');
}

main().catch((err) => {
  console.error('Workflow failed:', err);
  process.exit(1);
});
