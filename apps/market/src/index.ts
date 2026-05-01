import { serve } from '@hono/node-server';

import { createMarketApp } from './app';
import { createMarketDatabase } from './db';
import { loadEnv } from './env';

const env = loadEnv();
const db = createMarketDatabase(env.DATABASE_URL);
const app = createMarketApp({ db, env });

serve(
  {
    fetch: app.fetch,
    port: env.MARKET_PORT,
  },
  (info) => {
    console.info(`[market] listening on http://localhost:${info.port}`);
  },
);
