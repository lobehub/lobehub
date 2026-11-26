// @vitest-environment node
import { describe } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import type { LobeChatDatabase } from '../../../type';
import { describeFtsSearchFileContentBehavior } from '../__tests__/fileContentBehavior';
import { FtsSearchRepo } from '../index';
import { PgSearchFtsSearchBackend } from './index';

const serverDB: LobeChatDatabase = await getTestDB();

// BM25 retrieval requires the pg_search extension (ParadeDB), not available in PGlite.
describe.skipIf(process.env.TEST_SERVER_DB !== '1')(
  'FtsSearchRepo file content (pg_search)',
  () => {
    describeFtsSearchFileContentBehavior({
      createRepo: (db, userId) =>
        new FtsSearchRepo(db, userId, undefined, undefined, {
          backend: new PgSearchFtsSearchBackend(db, { userId }),
        }),
      db: serverDB,
    });
  },
);
