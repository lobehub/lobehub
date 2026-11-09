import debug from 'debug';
import type { Context } from 'hono';

import { getServerDB } from '@/database/core/db-adaptor';
import { getDocumentCharLimitErrorData } from '@/server/services/document/writeLimit';
import { persistPageState, resolveRoomAccess } from '@/server/services/pageCollab';
import { PageProjectionRejectedError } from '@/server/services/pageCollab/persist';
import { fromBase64 } from '@/server/services/pageCollab/roomClient';
import { buildPageSeed, getPageRoomStatus } from '@/server/services/pageCollab/seed';

const log = debug('lobe-server:agent:document-collab');

export async function documentAccess(c: Context): Promise<Response> {
  const documentId = c.req.query('documentId');
  const userId = c.req.query('userId');
  if (!documentId || !userId) return c.json({ error: 'documentId and userId are required' }, 400);

  const access = await resolveRoomAccess(await getServerDB(), userId, documentId);
  return c.json({ access });
}

export async function documentSeed(c: Context): Promise<Response> {
  const documentId = c.req.query('documentId');
  if (!documentId) return c.json({ code: 'INVALID', error: 'documentId is required' }, 400);

  const seed = await buildPageSeed(await getServerDB(), documentId);
  if (seed.status !== 'ok') {
    return seed.status === 'not_found'
      ? c.json({ code: 'DOCUMENT_NOT_FOUND', error: 'Document not found' }, 404)
      : c.json({ code: 'ROOM_NOT_ALLOWED', error: 'Only workspace pages have rooms' }, 403);
  }
  return new Response(Buffer.from(seed.update), {
    headers: { 'Content-Type': 'application/octet-stream', 'X-Workspace-Id': seed.workspaceId },
  });
}

export async function documentRoomStatus(c: Context): Promise<Response> {
  const documentId = c.req.query('documentId');
  if (!documentId) return c.json({ code: 'INVALID', error: 'documentId is required' }, 400);

  return c.json(await getPageRoomStatus(await getServerDB(), documentId));
}

// Above this a projection could not have passed the platform's request cap
// anyway; the room's own cap is lower.
const MAX_PROJECTION_BYTES = 4 * 1024 * 1024;
const PROJECTION_SIZE_WARNING_BYTES = 1.5 * 1024 * 1024;

interface ProjectionRequest {
  actors?: unknown;
  documentId?: string;
  epoch?: string;
  sizeBytes?: number;
  update?: Uint8Array;
}

const parseActors = (value: string | undefined) => {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
};

// The room sends binary Yjs; a room released before that sends base64 JSON.
const readProjection = async (c: Context): Promise<ProjectionRequest> => {
  if (c.req.header('Content-Type')?.startsWith('application/octet-stream')) {
    const sizeHeader = Number(c.req.header('X-Room-Size-Bytes'));
    return {
      actors: parseActors(c.req.header('X-Room-Actors')),
      documentId: c.req.query('documentId'),
      epoch: c.req.query('epoch'),
      sizeBytes: Number.isFinite(sizeHeader) ? sizeHeader : undefined,
      update: new Uint8Array(await c.req.arrayBuffer()),
    };
  }

  const body = (await c.req.json().catch(() => null)) as {
    actors?: unknown;
    documentId?: string;
    epoch?: string;
    update?: unknown;
  } | null;
  return {
    actors: body?.actors,
    documentId: body?.documentId,
    epoch: body?.epoch,
    update: typeof body?.update === 'string' ? fromBase64(body.update) : undefined,
  };
};

export async function documentProjection(c: Context): Promise<Response> {
  const { actors, documentId, epoch, sizeBytes, update } = await readProjection(c);
  if (!documentId || !update) {
    return c.json({ code: 'INVALID', error: 'documentId and update are required' }, 400);
  }
  if (update.byteLength > MAX_PROJECTION_BYTES) {
    return c.json({ code: 'DOC_TOO_LARGE', error: 'Room state is too large to project' }, 413);
  }
  const roomBytes = sizeBytes ?? update.byteLength;
  if (roomBytes >= PROJECTION_SIZE_WARNING_BYTES) {
    console.warn('[document-projection] room %s holds %d bytes', documentId, roomBytes);
  }

  try {
    const projected = await persistPageState(await getServerDB(), documentId, update, {
      history: { editorIds: roomEditorIds(actors) },
      saveSource: 'autosave',
    });
    if (!projected) return c.json({ code: 'DOCUMENT_NOT_FOUND', error: 'Document not found' }, 404);
    return c.json({ ok: true });
  } catch (error) {
    log('projection failed for %s (epoch %s): %O', documentId, epoch, error);
    if (error instanceof PageProjectionRejectedError) {
      return c.json({ code: 'PROJECTION_REJECTED', error: error.message }, 409);
    }
    // The room grew the page past its plan's limit. The stored page keeps its
    // last accepted version; the room relays the refusal to the people editing.
    const charLimit = getDocumentCharLimitErrorData(error);
    if (charLimit) {
      return c.json({ ...charLimit, error: (error as Error).message }, 422);
    }
    console.error('[document-projection] failed for %s:', documentId, error);
    return c.json({ code: 'INTERNAL', error: (error as Error).message }, 500);
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
