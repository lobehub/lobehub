import path from 'node:path';

import tsconfigPaths from 'vite-tsconfig-paths';

import { antdStaticCssOptions, themeVarsCssOptions } from './staticCssOptions.mjs';
import { createShareRrConfig } from './vite.config.shared.mts';

const appRoot = path.resolve(import.meta.dirname);

// A host repo that overlays this app (lobehub-cloud maps `@/business/*` and
// friends onto its own implementations) points this at its root tsconfig.
// Vite 8's native tsconfigPaths resolves against the tsconfig nearest each
// importer, which for submodule files is this repo's — losing the overlay.
const overlayTsconfig = process.env.SHARE_TSCONFIG_PROJECT;

const parseExtraStubs = (raw: string | undefined): Record<string, string> | undefined => {
  if (!raw) return undefined;

  return Object.fromEntries(
    raw
      .split(',')
      .map((entry) => entry.split('=').map((part) => part.trim()))
      .filter((pair): pair is [string, string] => pair.length === 2 && Boolean(pair[0] && pair[1])),
  );
};

export default createShareRrConfig({
  appRoot,
  extraSsrStubs: parseExtraStubs(process.env.SHARE_EXTRA_SSR_STUBS),
  repoRoot: overlayTsconfig ? path.dirname(overlayTsconfig) : path.resolve(appRoot, '../..'),
  resolvePlugins: overlayTsconfig
    ? [
        tsconfigPaths({
          ignoreConfigErrors: true,
          projects: [overlayTsconfig],
          root: path.dirname(overlayTsconfig),
        }),
      ]
    : undefined,
  staticCss: { antd: antdStaticCssOptions, themeVars: themeVarsCssOptions },
});
