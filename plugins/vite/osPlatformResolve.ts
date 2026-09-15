import { access } from 'node:fs/promises';

import type { Plugin } from 'vite';

export type OsPlatform = 'linux' | 'mac' | 'windows';

const NODE_TO_OS = {
  darwin: 'mac',
  linux: 'linux',
  win32: 'windows',
} as const satisfies Record<string, OsPlatform>;

export const resolveOsPlatform = (
  nodePlatform = process.env.npm_config_platform || process.platform,
): OsPlatform => NODE_TO_OS[nodePlatform as keyof typeof NODE_TO_OS] ?? 'linux';

const EXT_RE = /\.(ts|tsx|js|jsx|mts|mjs|cts|cjs)$/;
const OS_FILE_RE = /\.(?:linux|mac|windows)\.(?:ts|tsx|js|jsx|mts|mjs|cts|cjs)$/;

export function viteOsPlatformResolve(os: OsPlatform = resolveOsPlatform()): Plugin {
  const suffix = `.${os}`;

  return {
    enforce: 'pre',
    name: 'vite-os-platform-resolve',
    async resolveId(source, importer, options) {
      if (!importer || importer.includes('node_modules')) return null;

      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!resolved) return null;

      const id = resolved.id.split('?')[0];
      if (OS_FILE_RE.test(id)) return null;

      const extMatch = id.match(EXT_RE);
      if (!extMatch) return null;

      const candidate = `${id.slice(0, -extMatch[0].length)}${suffix}${extMatch[0]}`;
      if (importer.split('?')[0].replaceAll('\\', '/') === candidate.replaceAll('\\', '/')) {
        return null;
      }

      try {
        await access(candidate);
        return candidate;
      } catch {
        return null;
      }
    },
  };
}
