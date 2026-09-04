import { Hono, type MiddlewareHandler } from 'hono';

import { bearerSecretAuth } from '../../agent/middlewares/bearerSecretAuth';
import { qstashAuth } from '../middlewares/qstashAuth';
import { purge } from './handlers/purge';

const app = new Hono();

const purgePostAuth: MiddlewareHandler = async (ctx, next) => {
  if (process.env.QSTASH_CURRENT_SIGNING_KEY) return qstashAuth()(ctx, next);

  // The no-QStash scheduler runs in-process, so an external POST is never
  // implicitly trusted. Keep a manual/self-hosted trigger available behind
  // the same bearer secret as the cron endpoint, and fail closed when unset.
  return bearerSecretAuth(() => process.env.CRON_SECRET)(ctx, next);
};

app.get(
  '/purge',
  bearerSecretAuth(() => process.env.CRON_SECRET),
  purge,
);
app.post('/purge', purgePostAuth, purge);
app.post(
  '/purge/local',
  bearerSecretAuth(() => process.env.KEY_VAULTS_SECRET),
  purge,
);

export default app;
