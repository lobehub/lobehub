import debug from 'debug';
import type { Context } from 'hono';

import { getServerDB } from '@/database/core/db-adaptor';
import { persistPageState, resolvePageAccess } from '@/server/services/pageCollab';
import { PageProjectionRejectedError } from '@/server/services/pageCollab/persist';
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
    /** Users whose updates reached the room since its last projection. */
    actors?: unknown;
    documentId?: string;
    epoch?: string;
    update?: string;
  } | null;
  if (!body?.documentId || typeof body.update !== 'string') {
    return c.json({ error: 'documentId and update are required' }, 400);
  }

  try {
    const projected = await persistPageState(
      await getServerDB(),
      body.documentId,
      fromBase64(body.update),
      { history: { editorIds: roomEditorIds(body.actors) }, saveSource: 'autosave' },
    );
    if (!projected) return c.json({ error: 'Document not found' }, 404);
    return c.json({ ok: true });
  } catch (error) {
    log('projection failed for %s (epoch %s): %O', body.documentId, body.epoch, error);
    if (error instanceof PageProjectionRejectedError) {
      return c.json({ error: error.message }, 409);
    }
    return c.json({ error: (error as Error).message }, 500);
  }
}

// Agent and external pushes are recorded by the server when it makes them;
// only people editing in the room are attributed here.
const roomEditorIds = (actors: unknown) =>
  Array.isArray(actors)
    ? actors.filter(
        (actor): actor is string =>
          typeof actor === 'string' && !!actor && !/^(?:agent|external|bootstrap)\b/.test(actor),
      )
    : undefined;
