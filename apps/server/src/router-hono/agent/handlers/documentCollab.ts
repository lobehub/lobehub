import debug from 'debug';
import type { Context } from 'hono';

import { getServerDB } from '@/database/core/db-adaptor';
import { projectPageRoom, resolvePageAccess } from '@/server/services/pageCollab';
import { fromBase64 } from '@/server/services/pageCollab/roomClient';

const log = debug('lobe-server:agent:document-collab');

export async function documentAccess(c: Context): Promise<Response> {
  const documentId = c.req.query('documentId');
  const userId = c.req.query('userId');
  if (!documentId || !userId) return c.json({ error: 'documentId and userId are required' }, 400);

  const access = await resolvePageAccess(await getServerDB(), userId, documentId);
  return c.json({ access });
}

export async function documentProjection(c: Context): Promise<Response> {
  const body = (await c.req.json().catch(() => null)) as {
    documentId?: string;
    epoch?: string;
    update?: string;
  } | null;
  if (!body?.documentId || typeof body.update !== 'string') {
    return c.json({ error: 'documentId and update are required' }, 400);
  }

  try {
    const projected = await projectPageRoom(
      await getServerDB(),
      body.documentId,
      fromBase64(body.update),
    );
    if (!projected) return c.json({ error: 'Document not found' }, 404);
    return c.json({ ok: true });
  } catch (error) {
    log('projection failed for %s (epoch %s): %O', body.documentId, body.epoch, error);
    return c.json({ error: (error as Error).message }, 500);
  }
}
