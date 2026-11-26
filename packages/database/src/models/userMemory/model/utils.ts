import type { AnyColumn, SQL } from 'drizzle-orm';
import { or, sql } from 'drizzle-orm';

import type { LobeChatDatabase } from '../../../type';

export const coerceDate = (input: unknown): Date | null => {
  if (input === null || input === undefined) return null;
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : input;
  }
  if (typeof input === 'string' || typeof input === 'number') {
    const date = new Date(input);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
};

export const escapeLikePattern = (value: string) =>
  value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');

export const buildContainsCondition = (column: unknown, q?: string) => {
  const normalized = q?.trim();
  if (!normalized) return undefined;

  return sql<boolean>`${column} ILIKE ${`%${escapeLikePattern(normalized)}%`} ESCAPE '\\'`;
};

export const isPGliteDatabase = (db: LobeChatDatabase) => {
  const client = (
    db as unknown as {
      $client?: {
        dataDir?: unknown;
        waitReady?: unknown;
      };
    }
  ).$client;

  return !!client && 'waitReady' in client && 'dataDir' in client;
};

export const buildTextSearchCondition = (params: {
  bm25MatchQuery: string;
  groups: { fallbackColumns: unknown[]; fields: string[]; keyColumn: AnyColumn }[];
  normalizedQuery: string;
  supportsBm25: boolean;
}) => {
  const { bm25MatchQuery, groups, normalizedQuery, supportsBm25 } = params;

  if (!normalizedQuery) return undefined;

  const conditions = supportsBm25
    ? groups
        .map(({ fields, keyColumn }) => {
          if (fields.length === 0) return undefined;

          const matchQueries = fields.map(
            (field) => sql`paradedb.match(${field}, ${bm25MatchQuery}, conjunction_mode => true)`,
          );

          return sql<boolean>`${keyColumn} @@@ paradedb.boolean(should => ARRAY[${sql.join(matchQueries, sql`, `)}])`;
        })
        .filter((condition): condition is SQL<boolean> => Boolean(condition))
    : groups
        .flatMap(({ fallbackColumns }) => fallbackColumns)
        .map((column) => buildContainsCondition(column, normalizedQuery))
        .filter((condition): condition is SQL<boolean> => Boolean(condition));

  return conditions.length > 0 ? or(...conditions) : undefined;
};
