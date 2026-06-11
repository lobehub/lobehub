import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { Plugin } from 'vite';

export const SHARED_REACT_VENDOR_DIR = 'dist/vendor-shared';

export interface SharedReactVendorManifest {
  files: string[];
  specifiers: Record<string, string>;
}

export interface SharedReactVendor {
  paths: Record<string, string>;
  urls: string[];
}

export function loadSharedReactVendor(root: string, assetBase: string): SharedReactVendor {
  const manifestFile = path.resolve(root, SHARED_REACT_VENDOR_DIR, 'manifest.json');

  if (!existsSync(manifestFile)) {
    throw new Error(
      `Shared react vendor manifest not found at ${manifestFile}. Run \`bun run build:spa:vendor\` first.`,
    );
  }

  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as SharedReactVendorManifest;
  const base = assetBase.endsWith('/') ? assetBase : `${assetBase}/`;
  const toUrl = (file: string) => `${base}vendor-shared/${file}`;

  return {
    paths: Object.fromEntries(
      Object.entries(manifest.specifiers).map(([specifier, file]) => [specifier, toUrl(file)]),
    ),
    urls: manifest.files.map(toUrl),
  };
}

export function sharedReactVendorPreload(urls: string[]): Plugin {
  return {
    name: 'lobe-shared-react-vendor-preload',
    transformIndexHtml: {
      handler: () =>
        urls.map((href) => ({
          attrs: { crossorigin: true, href, rel: 'modulepreload' },
          injectTo: 'head' as const,
          tag: 'link',
        })),
      order: 'post',
    },
  };
}
