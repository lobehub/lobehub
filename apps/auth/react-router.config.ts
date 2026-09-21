import type { Config } from '@react-router/dev/config';

import { PRERENDER_ROUTES } from './app/lib/prerender';

export default {
  appDirectory: 'app',
  // One pass per locale writes into its own directory; scripts/build.mjs folds
  // the non-default passes' documents back into the default build.
  buildDirectory: process.env.AUTH_BUILD_DIR || 'build',
  prerender: [...PRERENDER_ROUTES],
  // Lazy discovery hits /__manifest, which the gateway routes to the default
  // target (app) on the shared lobehub.com origin — the HTML reply breaks
  // client navigations. The route table is tiny; ship it with the document.
  routeDiscovery: { mode: 'initial' },
  ssr: false,
} satisfies Config;
