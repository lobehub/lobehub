import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import { getServerDB } from '@/database/core/db-adaptor';
import { ClaudeCodeGatewayService } from '@/server/services/claudeCodeGateway';

const app = new Hono().basePath('/api/claude-code');

app.use('/v1/messages', bodyLimit({ maxSize: 10 * 1024 * 1024 }));

app.post('/v1/messages', async (c) => {
  const db = await getServerDB();
  return new ClaudeCodeGatewayService(db).handle(c.req.raw);
});

export default app;
