import debug from 'debug';

import { afterUnscoped } from '@/server/utils/scheduleAfterResponse';

import { isPageCollabEnabled } from './config';
import { createPageRoomClient, type PageRoomClient } from './roomClient';

const log = debug('lobe-server:page-collab:notify');

const ATTEMPTS = 3;
const RETRY_MS = 500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const dropWithRetry = async (room: PageRoomClient, documentId: string) => {
  for (let attempt = 1; ; attempt++) {
    try {
      await room.dropRoom(documentId);
      return;
    } catch (error) {
      log('dropping room %s failed (attempt %d): %O', documentId, attempt, error);
      if (attempt >= ATTEMPTS) return;
      await sleep(RETRY_MS * 3 ** (attempt - 1));
    }
  }
};

// The gateway's daily patrol is the backstop, so a drop that never lands only
// keeps a room around a little longer.
export const dropPageRooms = (documentIds: string[]) => {
  if (documentIds.length === 0 || !isPageCollabEnabled()) return;
  const room = createPageRoomClient();
  if (!room) return;

  afterUnscoped(async () => {
    for (const documentId of documentIds) await dropWithRetry(room, documentId);
  });
};
