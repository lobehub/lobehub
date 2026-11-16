import { sql } from 'drizzle-orm';

import type { LobeChatDatabase } from '../type';

/**
 * Transaction-scoped advisory lock shared by every path that writes a `files`
 * row together with the `documents` rows parsed from it.
 *
 * Those paths deliberately take the two aggregates in different orders:
 * `parseFile` and `FileVisibilityRepository.setVisibility` start from the file
 * (they need its visibility first), while `updateFile` moves the documents
 * before the file to match `updateDocument`. Row locks alone cannot keep the two
 * from deadlocking, because the orders cross, so both sides take this lock
 * before touching either aggregate — that serialises them per file.
 *
 * The key literal stays `parseFile:<id>` even though the lock now guards more
 * than parsing: the key is a cross-version contract, and renaming it would let
 * an older process and a newer one take different locks during a rolling deploy.
 */
export const lockFileForWrite = async (db: LobeChatDatabase, fileId: string): Promise<void> => {
  await db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`parseFile:${fileId}`})::bigint)`);
};
