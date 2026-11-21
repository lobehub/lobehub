// import env
// mock indexedDB to test with dexie
// refs: https://github.com/dumbmatter/fakeIndexedDB#dexie-and-other-indexeddb-api-wrappers
import 'fake-indexeddb/auto';

import * as dotenv from 'dotenv';

dotenv.config();

// Server-DB mode runs every file in one shared database, one after another. A
// project now always has an environment, and `environments.user_id` /
// `workspace_id` are `restrict`: one environment a file leaves behind blocks
// the next file's `delete(users)` and cascades into hundreds of failures far
// from the file that left it. So each file ends with no environment in the
// database, whatever its own cleanup did.
if (process.env.TEST_SERVER_DB === '1') {
  const { afterAll } = await import('vitest');

  afterAll(async () => {
    const { getTestDB } = await import('../src/core/getTestDB');
    const { environmentInstances, environments, projectEnvironments } =
      await import('../src/schemas');
    const db = await getTestDB();

    await db.delete(projectEnvironments);
    await db.delete(environmentInstances);
    await db.delete(environments);
  });
}
