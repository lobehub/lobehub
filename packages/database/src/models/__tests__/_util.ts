import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { drizzle } from 'drizzle-orm/pglite';

import migrations from '../../core/migrations.json';
import * as schema from '../../schemas';
import { LobeChatDatabase } from '../../type';

const isServerDBMode = process.env.TEST_SERVER_DB === '1';

let testClientDB: ReturnType<typeof drizzle<typeof schema>> | null = null;

export const getTestDB = async () => {
  if (isServerDBMode) {
    const { getTestDBInstance } = await import('../../core/dbForTest');
    return await getTestDBInstance();
  }

  if (testClientDB) return testClientDB as unknown as LobeChatDatabase;

  // 直接使用 pglite 内置资源，不需要从 CDN 下载
  const pglite = new PGlite({ extensions: { vector } });

  testClientDB = drizzle({ client: pglite, schema });

  // @ts-expect-error - migrate internal API
  await testClientDB.dialect.migrate(migrations, testClientDB.session, {});

  return testClientDB as unknown as LobeChatDatabase;
};
