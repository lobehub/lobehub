import * as dotenv from 'dotenv';
import dotenvExpand from 'dotenv-expand';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Use createRequire for CommonJS module compatibility
const require = createRequire(import.meta.url);
const { checkDeprecatedAuth } = require('./_shared/checkDeprecatedAuth.js');

const isDesktop = process.env.NEXT_PUBLIC_IS_DESKTOP_APP === '1';
const isBundleAnalyzer = process.env.ANALYZE === 'true' && process.env.CI === 'true';
const isServerDB = !!process.env.DATABASE_URL;

if (isDesktop) {
  dotenvExpand.expand(dotenv.config({ path: '.env.desktop' }));
  dotenvExpand.expand(dotenv.config({ override: true, path: '.env.desktop.local' }));
} else {
  dotenvExpand.expand(dotenv.config());
}

const AUTH_SECRET_DOC_URL =
  'https://lobehub.com/docs/self-hosting/environment-variables/auth#auth-secret';
const KEY_VAULTS_SECRET_DOC_URL =
  'https://lobehub.com/docs/self-hosting/environment-variables/basic#key-vaults-secret';

/**
 * Check for required environment variables in server database mode
 */
const checkRequiredEnvVars = () => {
  if (isDesktop || !isServerDB) return;

  const missingVars: { docUrl: string; name: string }[] = [];

  if (!process.env.AUTH_SECRET) {
    missingVars.push({ docUrl: AUTH_SECRET_DOC_URL, name: 'AUTH_SECRET' });
  }

  if (!process.env.KEY_VAULTS_SECRET) {
    missingVars.push({ docUrl: KEY_VAULTS_SECRET_DOC_URL, name: 'KEY_VAULTS_SECRET' });
  }

  if (missingVars.length > 0) {
    console.error('\n' + '═'.repeat(70));
    console.error('❌ ERROR: Missing required environment variables!');
    console.error('═'.repeat(70));
    console.error('\nThe following environment variables are required for server database mode:\n');
    for (const { name, docUrl } of missingVars) {
      console.error(`  • ${name}`);
      console.error(`    📖 Documentation: ${docUrl}\n`);
    }
    console.error('Please configure these environment variables and redeploy.');
    console.error(
      '\n💡 TIP: If you previously used NEXT_AUTH_SECRET, simply rename it to AUTH_SECRET.',
    );
    console.error('═'.repeat(70) + '\n');
    process.exit(1);
  }
};

const getCommandVersion = (command: string): string | null => {
  try {
    return execSync(`${command} --version`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
      .trim()
      .split('\n')[0];
  } catch {
    return null;
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
  console.log(
    `    VERCEL_PROJECT_PRODUCTION_URL: ${process.env.VERCEL_PROJECT_PRODUCTION_URL ?? '(not set)'}`,
  );
  console.log(`    AUTH_EMAIL_VERIFICATION: ${process.env.AUTH_EMAIL_VERIFICATION ?? '(not set)'}`);
  console.log(`    AUTH_ENABLE_MAGIC_LINK: ${process.env.AUTH_ENABLE_MAGIC_LINK ?? '(not set)'}`);

  // Check SSO providers configuration
  const ssoProviders = process.env.AUTH_SSO_PROVIDERS;
  console.log(`    AUTH_SSO_PROVIDERS: ${ssoProviders ?? '(not set)'}`);

  if (ssoProviders) {
    const getEnvPrefix = (provider: string) =>
      `AUTH_${provider.toUpperCase().replaceAll('-', '_')}`;

    const providers = ssoProviders
      .split(/[,，]/)
      .map((p) => p.trim())
      .filter(Boolean);
    const missingProviders: string[] = [];

    for (const provider of providers) {
      const envPrefix = getEnvPrefix(provider);
      const hasEnvVar = Object.keys(process.env).some((key) => key.startsWith(envPrefix));
      if (!hasEnvVar) {
        missingProviders.push(provider);
      }
    }

    if (missingProviders.length > 0) {
      console.log('\n  ⚠️  SSO Provider Configuration Warning:');
      for (const provider of missingProviders) {
        console.log(
          `    - "${provider}" is configured but no ${getEnvPrefix(provider)}_* env vars found`,
        );
      }
    }
  }

  console.log('─'.repeat(50));
};

// 创建需要排除的特性映射

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
  // Check for deprecated auth env vars first - fail fast if found
  checkDeprecatedAuth();

  // Check for required env vars in server database mode
  checkRequiredEnvVars();

  printEnvInfo();
  // 执行删除操作
  console.log('\nStarting prebuild cleanup...');
  await runPrebuild();
  console.log('Prebuild cleanup completed.');
}
