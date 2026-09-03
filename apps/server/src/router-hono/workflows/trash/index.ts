import { Hono } from 'hono';

import { bearerSecretAuth } from '../../agent/middlewares/bearerSecretAuth';
import { qstashAuth } from '../middlewares/qstashAuth';
import { purge } from './handlers/purge';

const app = new Hono();

app.post('/purge', qstashAuth(), purge);
app.post(
  '/purge/local',
  bearerSecretAuth(() => process.env.KEY_VAULTS_SECRET),
  purge,
);

export default app;
