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
  // 执行删除操作
  console.log('Starting prebuild cleanup...');
  await runPrebuild();
  console.log('Prebuild cleanup completed.');
}
