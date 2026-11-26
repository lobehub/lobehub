import { Hono } from 'hono';
import { z } from 'zod';

import {
  FILE_TASK_QUEUE_RETRIES,
  processQueuedFileTask,
} from '@/server/services/fileTaskAdmission';

import { qstashAuth } from '../middlewares/qstashAuth';

const payloadSchema = z.object({
  fileId: z.string(),
  kind: z.enum(['embedding', 'parse']),
  queuedUntil: z.string(),
  taskId: z.string(),
  userId: z.string(),
  workspaceId: z.string().optional(),
});

const app = new Hono();

app.post('/dispatch', qstashAuth(), async (c) => {
  const payload = payloadSchema.safeParse(await c.req.json().catch(() => undefined));
  if (!payload.success) return c.json({ error: 'Invalid payload' }, 400);

  const retried = Number(c.req.header('Upstash-Retried') ?? 0);
  const outcome = await processQueuedFileTask(payload.data, {
    finalAttempt: retried >= FILE_TASK_QUEUE_RETRIES,
  });

  return c.json({ outcome });
});

export default app;
