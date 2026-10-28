// @vitest-environment node
import { LayersEnum } from '@lobechat/types';
import type * as DrizzleOrm from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as IdentityModule from '../identity';
import type { UserMemoryModelContext } from '../model/context';
import type * as ListMemoriesModule from '../model/listMemories';
import type * as QueryMemoriesModule from '../model/queryMemories';

/**
 * `eq()` / `inArray()` always yield a SQL fragment, so the `filters.length ? and(...) : undefined`
 * fallbacks in listMemories / queryMemories / identity queryList cannot be reached through real
 * inputs. Let them drop out on demand (delegating to drizzle otherwise) so those defensive
 * fallbacks are pinned to "no WHERE clause".
 */
const eqState = vi.hoisted(() => ({ drop: false }));

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof DrizzleOrm>();

  return {
    ...actual,
    eq: (...args: Parameters<typeof actual.eq>) => (eqState.drop ? undefined : actual.eq(...args)),
    inArray: (...args: Parameters<typeof actual.inArray>) =>
      eqState.drop ? undefined : actual.inArray(...args),
  };
});

// With `isolate: false` another suite may already have evaluated these modules against the real
// drizzle; a query-suffixed specifier forces a fresh evaluation that resolves the mocked helpers.
const { listMemories }: typeof ListMemoriesModule =
  // @ts-expect-error -- query-suffixed specifiers only resolve through the Vite module runner
  await import('../model/listMemories?empty-where');
const { queryMemories }: typeof QueryMemoriesModule =
  // @ts-expect-error -- query-suffixed specifiers only resolve through the Vite module runner
  await import('../model/queryMemories?empty-where');
const { UserMemoryIdentityModel }: typeof IdentityModule =
  // @ts-expect-error -- query-suffixed specifiers only resolve through the Vite module runner
  await import('../identity?empty-where');

interface RecordedQuery {
  where: unknown[];
}

/** Chainable fake query builder: records `.where()` arguments and resolves to `rows`. */
const createFakeDb = (rows: unknown[]) => {
  const queries: RecordedQuery[] = [];

  const select = () => {
    const recorded: RecordedQuery = { where: [] };
    queries.push(recorded);

    const builder: any = new Proxy(
      {},
      {
        get: (_target, prop) => {
          if (prop === 'then') {
            return (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
              Promise.resolve(rows).then(resolve, reject);
          }
          if (prop === 'where') {
            return (clause: unknown) => {
              recorded.where.push(clause);
              return builder;
            };
          }
          return () => builder;
        },
      },
    );

    return builder;
  };

  return { db: { select } as any, queries };
};

const createCtx = (rows: unknown[] = []) => {
  const fake = createFakeDb(rows);
  const ctx = {
    db: fake.db,
    memoryWhere: () => undefined,
    userId: 'empty-where-user',
  } as unknown as UserMemoryModelContext;

  return { ctx, queries: fake.queries };
};

afterEach(() => {
  eqState.drop = false;
});

describe('userMemory empty WHERE fallbacks', () => {
  it.each([LayersEnum.Context, LayersEnum.Experience, LayersEnum.Identity, LayersEnum.Preference])(
    'listMemories(%s) queries without a WHERE clause when no scope condition remains',
    async (layer) => {
      eqState.drop = true;
      const { ctx, queries } = createCtx([]);

      const result = await listMemories(ctx, { layer });

      expect(result).toEqual([]);
      expect(queries).toHaveLength(1);
      expect(queries[0].where).toEqual([undefined]);
    },
  );

  it.each([
    LayersEnum.Context,
    LayersEnum.Activity,
    LayersEnum.Experience,
    LayersEnum.Identity,
    LayersEnum.Preference,
  ])(
    'queryMemories(%s) queries without a WHERE clause and treats a missing count as 0',
    async (layer) => {
      eqState.drop = true;
      const { ctx, queries } = createCtx([]);

      const result = await queryMemories(ctx, { layer });

      expect(result).toEqual({ items: [], page: 1, pageSize: 20, total: 0 });
      // rows query + count query, both unfiltered
      expect(queries).toHaveLength(2);
      expect(queries.map((query) => query.where)).toEqual([[undefined], [undefined]]);
    },
  );

  it('identity queryList queries without a WHERE clause and treats a missing count as 0', async () => {
    eqState.drop = true;
    const { ctx, queries } = createCtx([]);
    const model = new UserMemoryIdentityModel(ctx.db, 'empty-where-user');
    (model as any).memoryWhere = () => undefined;

    const result = await model.queryList();

    expect(result).toEqual({ items: [], page: 1, pageSize: 20, total: 0 });
    expect(queries.map((query) => query.where)).toEqual([[undefined], [undefined]]);
  });
});
