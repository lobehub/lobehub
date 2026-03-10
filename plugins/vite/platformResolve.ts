import { access } from 'node:fs/promises';

import type { Plugin } from 'vite';

type Platform = 'web' | 'mobile' | 'desktop';

/**
 * Resolves platform-specific file variants by suffix priority:
 *   1. `.vite`    — Vite-specific override (highest)
 *   2. `.mobile`  — mobile build only
 *   ∞. fallback   — original file
 *
 * Example: importing `./locale.ts` on a mobile build tries
 *   locale.vite.ts → locale.mobile.ts → locale.ts
 */
export function vitePlatformResolve(platform?: Platform): Plugin {
  const suffixes: string[] = [];
  if (platform) suffixes.push(`.${platform}`);
  suffixes.push('.vite');
  const EXT_RE = /\.(ts|tsx|js|jsx)$/;
  const PLATFORM_RE = /\.(?:vite|web|mobile|desktop)\.(?:ts|tsx|js|jsx)$/;

  return {
    enforce: 'pre',
    name: 'vite-platform-resolve',
    async resolveId(source, importer, options) {
      if (!importer || importer.includes('node_modules')) return null;

      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!resolved) return null;

      const id = resolved.id.split('?')[0];

      const extMatch = id.match(EXT_RE);
      if (!extMatch) return null;

      // Already a platform-specific file — skip to avoid infinite loop
      if (PLATFORM_RE.test(id)) return null;

      const basePath = id.slice(0, -extMatch[0].length);
      const ext = extMatch[0];

      for (const suffix of suffixes) {
        const candidate = `${basePath}${suffix}${ext}`;
        try {
          await access(candidate);
          return candidate;
        } catch {
          // Not found, try next
        }
      }

      return null;
    },
  };
}
