import { execSync } from 'node:child_process';
import * as dotenv from 'dotenv';
import dotenvExpand from 'dotenv-expand';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const isDesktop = process.env.NEXT_PUBLIC_IS_DESKTOP_APP === '1';
const isBundleAnalyzer = process.env.ANALYZE === 'true' && process.env.CI === 'true';

if (isDesktop) {
  dotenvExpand.expand(dotenv.config({ path: '.env.desktop' }));
  dotenvExpand.expand(dotenv.config({ override: true, path: '.env.desktop.local' }));
} else {
  dotenvExpand.expand(dotenv.config());
}

// Auth flags - use process.env directly for build-time dead code elimination
const enableBetterAuth = process.env.NEXT_PUBLIC_ENABLE_BETTER_AUTH === '1';
const enableNextAuth = process.env.NEXT_PUBLIC_ENABLE_NEXT_AUTH === '1';
const enableAuth = enableBetterAuth || enableNextAuth || false;

const getCommandVersion = (command: string): string | null => {
  try {
    return execSync(`${command} --version`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
      .trim()
      .split('\n')[0];
  } catch {
    return null;
  }
};

const CLERK_MIGRATION_DOC_URL = 'https://lobehub.com/docs/self-hosting/advanced/auth/clerk-to-betterauth';

/**
 * Check for deprecated Clerk environment variables and fail build if found
 */
const checkDeprecatedClerkEnv = () => {
  const clerkEnvVars = [
    'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
    'CLERK_SECRET_KEY',
    'CLERK_WEBHOOK_SECRET',
  ];

  const foundClerkEnvVars = clerkEnvVars.filter((envVar) => process.env[envVar]);

  if (foundClerkEnvVars.length > 0) {
    console.error('\n' + '═'.repeat(70));
    console.error('❌ ERROR: Clerk authentication is no longer supported!');
    console.error('═'.repeat(70));
    console.error('\nDetected deprecated Clerk environment variables:');
    for (const envVar of foundClerkEnvVars) {
      console.error(`  • ${envVar}`);
    }
    console.error('\nClerk has been removed from LobeChat. Please migrate to Better Auth.');
    console.error(`\n📖 Migration guide: ${CLERK_MIGRATION_DOC_URL}`);
    console.error('\nAfter migration, remove the Clerk environment variables and redeploy.');
    console.error('═'.repeat(70) + '\n');
    process.exit(1);
  }
};

const printEnvInfo = () => {
  console.log('\n📋 Build Environment Info:');
  console.log('─'.repeat(50));

  // Runtime versions
  console.log(`  Node.js: ${process.version}`);
  console.log(`  npm: ${getCommandVersion('npm') ?? 'not installed'}`);

  const bunVersion = getCommandVersion('bun');
  if (bunVersion) console.log(`  bun: ${bunVersion}`);

  const pnpmVersion = getCommandVersion('pnpm');
  if (pnpmVersion) console.log(`  pnpm: ${pnpmVersion}`);

  // Auth-related env vars
  console.log('\n  Auth Environment Variables:');
  console.log(`    APP_URL: ${process.env.APP_URL ?? '(not set)'}`);
  console.log(`    VERCEL_URL: ${process.env.VERCEL_URL ?? '(not set)'}`);
  console.log(`    VERCEL_BRANCH_URL: ${process.env.VERCEL_BRANCH_URL ?? '(not set)'}`);
  console.log(`    VERCEL_PROJECT_PRODUCTION_URL: ${process.env.VERCEL_PROJECT_PRODUCTION_URL ?? '(not set)'}`);
  console.log(`    AUTH_EMAIL_VERIFICATION: ${process.env.AUTH_EMAIL_VERIFICATION ?? '(not set)'}`);
  console.log(`    ENABLE_MAGIC_LINK: ${process.env.ENABLE_MAGIC_LINK ?? '(not set)'}`);
  console.log(`    AUTH_SECRET: ${process.env.AUTH_SECRET ? '✓ set' : '✗ not set'}`);
  console.log(`    KEY_VAULTS_SECRET: ${process.env.KEY_VAULTS_SECRET ? '✓ set' : '✗ not set'}`);

  // Auth flags
  console.log('\n  Auth Flags:');
  console.log(`    enableBetterAuth: ${enableBetterAuth}`);
  console.log(`    enableNextAuth: ${enableNextAuth}`);
  console.log(`    enableAuth: ${enableAuth}`);

  console.log('─'.repeat(50));
};

// 创建需要排除的特性映射
/* eslint-disable sort-keys-fix/sort-keys-fix */
const partialBuildPages = [
  // no need for bundle analyzer (frontend only)
  {
    name: 'backend-routes',
    disabled: isBundleAnalyzer,
    paths: ['src/app/(backend)'],
  },
  // no need for desktop
  // {
  //   name: 'changelog',
  //   disabled: isDesktop,
  //   paths: ['src/app/[variants]/(main)/changelog'],
  // },
  {
    name: 'auth',
    disabled: isDesktop,
    paths: ['src/app/[variants]/(auth)'],
  },
  // {
  //   name: 'mobile',
  //   disabled: isDesktop,
  //   paths: ['src/app/[variants]/(main)/(mobile)'],
  // },
  {
    name: 'oauth',
    disabled: isDesktop,
    paths: ['src/app/[variants]/oauth', 'src/app/(backend)/oidc'],
  },
  {
    name: 'api-webhooks',
    disabled: isDesktop,
    paths: ['src/app/(backend)/api/webhooks'],
  },
  {
    name: 'market-auth',
    disabled: isDesktop,
    paths: ['src/app/market-auth-callback'],
  },
  {
    name: 'pwa',
    disabled: isDesktop,
    paths: ['src/manifest.ts', 'src/sitemap.tsx', 'src/robots.tsx', 'src/sw'],
  },
  // no need for web
  {
    name: 'desktop-devtools',
    disabled: !isDesktop,
    paths: ['src/app/desktop'],
  },
  {
    name: 'desktop-trpc',
    disabled: !isDesktop,
    paths: ['src/app/(backend)/trpc/desktop'],
  },
];
/* eslint-enable */

/**
 * 删除指定的目录
 */
export const runPrebuild = async (targetDir: string = 'src') => {
  // 遍历 partialBuildPages 数组
  for (const page of partialBuildPages) {
    // 检查是否需要禁用该功能
    if (page.disabled) {
      for (const dirPath of page.paths) {
        // Replace 'src' with targetDir
        const relativePath = dirPath.replace(/^src/, targetDir);
        const fullPath = path.resolve(process.cwd(), relativePath);

        // 检查目录是否存在
        if (existsSync(fullPath)) {
          try {
            // 递归删除目录
            await rm(fullPath, { force: true, recursive: true });
            console.log(`♻️ Removed ${relativePath} successfully`);
          } catch (error) {
            console.error(`Failed to remove directory ${relativePath}:`, error);
          }
        }
      }
    }
  }
};

// Check if the script is being run directly
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

if (isMainModule) {
  // Check for deprecated Clerk env vars first - fail fast if found
  checkDeprecatedClerkEnv();

  printEnvInfo();
  // 执行删除操作
  console.log('\nStarting prebuild cleanup...');
  await runPrebuild();
  console.log('Prebuild cleanup completed.');
}
