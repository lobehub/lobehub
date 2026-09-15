import type { Config } from '@react-router/dev/config';

export default {
  appDirectory: 'app',
  // Lazy discovery hits /__manifest, which the gateway routes to the default
  // target (landing) on the shared lobehub.com origin — the HTML reply breaks
  // client navigations. The route table is tiny; ship it with the document.
  routeDiscovery: { mode: 'initial' },
  ssr: true,
} satisfies Config;
