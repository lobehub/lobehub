import { serve } from '@hono/node-server';

import { createMarketApp } from './app';
import { loadEnv } from './env';

const env = loadEnv();
const app = createMarketApp();

serve(
  {
    fetch: app.fetch,
    port: env.MARKET_PORT,
  },
  (info) => {
    console.info(`[market] listening on http://localhost:${info.port}`);
  },
);
