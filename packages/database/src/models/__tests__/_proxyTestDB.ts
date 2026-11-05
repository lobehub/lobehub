import { drizzle as drizzleProxy } from 'drizzle-orm/pg-proxy';
import { Client, Pool } from 'pg';

import * as schema from '../../schemas';
import type { LobeChatDatabase } from '../../type';

/** One raw result in array row mode, as both node-postgres and PGlite return it. */
export interface ArrayQueryResult {
  fields: { name: string }[];
  rows: unknown[][];
}

type RowRewriter = (query: string, result: ArrayQueryResult) => unknown[][];

/**
 * Runs a query on the test database's own driver in array row mode. `getTestDB()` hands back
 * node-postgres (server suite, `TEST_SERVER_DB=1`) or PGlite (client suite), and the two take
 * row mode differently: a query-config object versus a third options argument.
 */
const queryArrayRows = (db: LobeChatDatabase, text: string, values: unknown[]) => {
  // A root database exposes its driver as `$client`; a transaction only through its session,
  // which holds the checked-out node-postgres client or PGlite's transaction handle.
  const client =
    (db as unknown as { $client?: unknown }).$client ??
    (db as unknown as { session: { client: unknown } }).session.client;

  return client instanceof Pool || client instanceof Client
    ? (client.query({ rowMode: 'array', text, values }) as Promise<ArrayQueryResult>)
    : (client as { query: (...args: unknown[]) => Promise<ArrayQueryResult> }).query(text, values, {
        rowMode: 'array',
      });
};

/**
 * A database seam at the driver boundary: every query still runs against the real test
 * database, but the rows come back through the driver's default type parsers (so timestamps
 * arrive as `Date`) and can optionally be rewritten before drizzle maps them.
 *
 * pg-proxy has no transactions of its own, so `transaction()` opens one on the real driver and
 * hands the callback a proxy bound to it: every statement inside still shares that connection,
 * and nested calls become savepoints.
 */
export const createProxyTestDB = (
  db: LobeChatDatabase,
  rewrite?: RowRewriter,
): LobeChatDatabase => {
  const proxy = drizzleProxy(
    async (query, params) => {
      const result = await queryArrayRows(db, query, params);
      return { rows: rewrite ? rewrite(query, result) : result.rows };
    },
    { schema },
  ) as unknown as LobeChatDatabase;

  return Object.assign(proxy, {
    transaction: ((callback, config) =>
      db.transaction(
        (tx) => callback(createProxyTestDB(tx as unknown as LobeChatDatabase, rewrite) as any),
        config,
      )) as LobeChatDatabase['transaction'],
  });
};

/** Index of a result column by its SQL name, for rewriters that patch one cell. */
export const columnIndex = (result: ArrayQueryResult, name: string) =>
  result.fields.findIndex((field) => field.name === name);
