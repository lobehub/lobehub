import path from 'node:path';

import tsconfigPaths from 'vite-tsconfig-paths';

import { antdStaticCssOptions, themeVarsCssOptions } from './staticCssOptions.mjs';
import { createAuthRrConfig } from './vite.config.shared.mts';

const appRoot = path.resolve(import.meta.dirname);

// A host repo that overlays this app (lobehub-cloud maps `@/business/*` and
// friends onto its own implementations) points this at its root tsconfig.
// Vite 8's native tsconfigPaths resolves against the tsconfig nearest each
// importer, which for submodule files is this repo's — losing the overlay.
const overlayTsconfig = process.env.AUTH_TSCONFIG_PROJECT;

export default createAuthRrConfig({
  appRoot,
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
