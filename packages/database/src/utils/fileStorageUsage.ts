import { max, type SQL, sql, sum } from 'drizzle-orm';

import { files } from '../schemas';
import type { LobeChatDatabase, Transaction } from '../type';

/**
 * Sums the storage taken by the `files` rows matching `where`, counting each stored
 * object once.
 *
 * Rows that reuse a global file (hash dedup on upload, copies, transfers) keep both its
 * `fileHash` and its storage `url`, so they occupy storage once. The hash alone is not a
 * safe key: it is supplied by the uploading client, and keying on it would let distinct
 * objects claiming one hash count as a single file. Rows without a hash count on their own.
 */
export const sumStoredFileSize = async (
  db: LobeChatDatabase | Transaction,
  where: SQL | undefined,
): Promise<number> => {
  const storedObjects = db
    .select({ size: max(files.size).as('size') })
    .from(files)
    .where(where)
    .groupBy(
      files.fileHash,
      files.url,
      sql`CASE WHEN ${files.fileHash} IS NULL THEN ${files.id} END`,
    )
    .as('stored_objects');

  const [row] = await db.select({ totalSize: sum(storedObjects.size) }).from(storedObjects);

  return Number(row?.totalSize ?? 0);
};
