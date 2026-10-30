// @vitest-environment node
import { describe } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import type { LobeChatDatabase } from '../../../type';
import { describeFtsSearchTimeRangeBehavior } from '../__tests__/timeRangeBehavior';
import { FtsSearchRepo } from '../index';
import { PgSearchFtsSearchBackend } from './index';

const serverDB: LobeChatDatabase = await getTestDB();

// BM25 retrieval requires the pg_search extension (ParadeDB), not available in PGlite.
describe.skipIf(process.env.TEST_SERVER_DB !== '1')('FtsSearchRepo time range (pg_search)', () => {
  describeFtsSearchTimeRangeBehavior({
    createRepo: (db, userId) =>
      new FtsSearchRepo(db, userId, undefined, undefined, {
        backend: new PgSearchFtsSearchBackend(db, { userId }),
      }),
    db: serverDB,
    supportsCandidates: false,
  });
});
