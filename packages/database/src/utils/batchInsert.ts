/**
 * Rows per bulk INSERT. PostgreSQL's extended protocol caps a single statement
 * at 65,535 bind parameters, so a wide table (e.g. `messages` with 31 columns)
 * overflows the cap at around 2,100 rows. 500 rows keeps the widest tables
 * around ~15.5k parameters per statement.
 */
export const INSERT_BATCH_SIZE = 500;

export const insertInBatches = async <T>(
  rows: T[],
  insertBatch: (batch: T[]) => Promise<unknown>,
) => {
  for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
    await insertBatch(rows.slice(i, i + INSERT_BATCH_SIZE));
  }
};

export interface SelfReferenceFixup<F extends string> {
  id: string;
  patch: Partial<Record<F, string>> & { updatedAt?: Date };
}

/**
 * Batched inserts break self-referential FKs (`messages.parentId`/`quotaId`,
 * `threads.parentThreadId`) when a row lands in an earlier batch than the row
 * it references — rows are ordered by `createdAt`, so this only happens on
 * timestamp ties, but it would abort the whole insert. Null those references
 * out for the insert and return them as fixups to UPDATE after all batches
 * landed.
 */
export const splitCrossBatchSelfReferences = <
  F extends string,
  T extends { id: string; updatedAt?: Date | null } & {
    [K in F]?: string | null;
  },
>(
  rows: T[],
  fields: F[],
): { fixups: SelfReferenceFixup<F>[]; rows: T[] } => {
  const batchByNewId = new Map(
    rows.map((row, index) => [row.id, Math.floor(index / INSERT_BATCH_SIZE)]),
  );
  const fixups: SelfReferenceFixup<F>[] = [];

  const sanitizedRows = rows.map((row, index) => {
    const patch: Partial<Record<F, string>> = {};
    let hasDeferredReference = false;

    for (const field of fields) {
      const value = row[field];
      if (typeof value !== 'string') continue;

      const targetBatch = batchByNewId.get(value);
      if (targetBatch === undefined || targetBatch <= Math.floor(index / INSERT_BATCH_SIZE))
        continue;

      patch[field] = value;
      hasDeferredReference = true;
    }

    if (!hasDeferredReference) return row;

    // The deferred UPDATE must restate the row's `updatedAt`: tables sharing
    // `updatedAt().$onUpdate(() => new Date())` would otherwise restamp only
    // the fixed-up rows and break recency ordering of copied histories.
    fixups.push({
      id: row.id,
      patch: row.updatedAt ? { ...patch, updatedAt: row.updatedAt } : patch,
    });

    const sanitized = { ...row };
    for (const field of Object.keys(patch) as F[]) sanitized[field] = null as T[F];
    return sanitized;
  });

  return { fixups, rows: sanitizedRows };
};
