// @vitest-environment node
import type { EvalMemoryFixture, SearchMemoryParams, SearchMemoryResult } from '@lobechat/types';
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { UserMemoryModel } from '@/database/models/userMemory';
import {
  agentEvalMemories,
  userMemories,
  userMemoriesActivities,
  userMemoriesContexts,
  userMemoriesIdentities,
  userMemoriesPreferences,
} from '@/database/schemas';
import { cleanupDB, setupEvalChain, userId } from '@/server/services/agentEvalRun/__tests__/_setup';
import { MemoryServerRuntimeService } from '@/server/services/toolExecution/serverRuntimes/memory';

import { AgentEvalMemoryService } from './index';
import { hasPgSearch } from './search';

const mocks = vi.hoisted(() => ({
  embed: vi.fn(),
  initModelRuntimeFromDB: vi.fn<(serverDB: unknown, actor: string) => Promise<unknown>>(
    async () => ({}),
  ),
}));

vi.mock('@/server/globalConfig', () => ({
  getServerDefaultFilesConfig: () => ({
    embeddingModel: { model: 'test-embedding', provider: 'test' },
  }),
}));
vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: mocks.initModelRuntimeFromDB,
  initModelRuntimeWithUserPayload: vi.fn(),
}));
vi.mock('@/server/services/memory/userMemory/embedding', () => ({
  embedUserMemoryTexts: mocks.embed,
}));
vi.mock('@/server/services/agentSignal/procedure', () => ({
  emitToolOutcomeSafely: vi.fn(),
  resolveToolOutcomeScope: vi.fn(),
}));
vi.mock('@/server/services/agentSignal/store/adapters/redis/policyStateStore', () => ({
  redisPolicyStateStore: {},
}));
vi.mock('@/server/services/ftsSearch', () => ({ createFtsSearchRepo: vi.fn() }));

const db = await getTestDB();
/** The BM25 pass needs pg_search; PGlite has none, so queried searches run only on a server DB. */
const bm25 = await hasPgSearch(db);

/**
 * A bag-of-words embedding: texts that share words are close, so ranking is
 * lexical. Two small text-dependent components keep any two texts at distinct
 * similarities: a tie (two entries equally far from the query) would leave the
 * order to the database, as a real embedding never does.
 */
const vectorOf = (text: string) => {
  const vector = Array.from({ length: 1024 }, () => 0);
  for (const token of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (token.length < 2) continue;
    let hash = 2;
    for (const char of token) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 1022;
    vector[hash + 2] += 1;
  }
  vector[0] = 0.5;
  vector[1] = text.length / 1000;
  return vector;
};

/** When every entry was remembered; both stores are pinned to it. */
const SEEDED_AT = new Date('2024-05-01T12:00:00.000Z');

const preference = (
  title: string,
  directive: string,
  extra: { category: string; suggestions?: string[]; tags: string[]; type: string },
) => ({
  details: directive,
  memoryCategory: extra.category,
  memoryType: 'preference',
  sourceIds: [],
  summary: title,
  tags: extra.tags,
  title,
  withPreference: {
    appContext: null,
    conclusionDirectives: directive,
    extractedLabels: [],
    extractedScopes: [],
    originContext: null,
    scorePriority: 0.8,
    suggestions: extra.suggestions ?? [],
    type: extra.type,
  },
});

const context = (
  title: string,
  description: string,
  extra: { category: string; status: string; tags: string[] },
) => ({
  details: description,
  memoryCategory: extra.category,
  memoryType: 'context',
  sourceIds: [],
  summary: title,
  tags: extra.tags,
  title,
  withContext: {
    associatedObjects: [],
    associatedSubjects: [],
    currentStatus: extra.status,
    description,
    labels: [],
    scoreImpact: 0.5,
    scoreUrgency: 0.5,
    title,
    type: 'project',
  },
});

/**
 * Entries whose words, tags, categories and layers overlap, so every signal of
 * the ranking (keyword, semantic, fuzzy, tags, categories, time) has something
 * to tell apart.
 */
const fixture: EvalMemoryFixture = {
  activities: [
    {
      details: 'Reviewed the latest allergy panel results.',
      memoryCategory: 'health',
      memoryType: 'activity',
      sourceIds: [],
      summary: 'Allergist appointment',
      tags: ['appointment'],
      title: 'Allergist follow-up',
      withActivity: {
        associatedLocations: [{ name: 'City Allergy Clinic', type: 'clinic' }],
        associatedObjects: [],
        associatedSubjects: [{ name: 'Dr. Kim', type: 'person' }],
        endsAt: '2024-05-03T15:00:00Z',
        feedback: 'Reassuring visit.',
        narrative: 'Reviewed the allergy panel results with Dr. Kim at the City Allergy Clinic.',
        notes: null,
        startsAt: '2024-05-03T14:00:00Z',
        status: 'completed',
        tags: ['health'],
        timezone: 'UTC',
        type: 'appointment',
      },
    },
    {
      details: 'A routine dental cleaning.',
      memoryCategory: 'health',
      memoryType: 'activity',
      sourceIds: [],
      summary: 'Dentist cleaning',
      tags: ['dentist'],
      title: 'Dentist cleaning',
      withActivity: {
        associatedLocations: [],
        associatedObjects: [],
        associatedSubjects: [],
        endsAt: null,
        feedback: null,
        narrative: 'Booked a dental cleaning for the first week of June.',
        notes: null,
        startsAt: '2024-06-04T09:00:00Z',
        status: 'planned',
        tags: null,
        timezone: 'UTC',
        type: 'appointment',
      },
    },
  ],
  contexts: [
    context(
      'GA4 monitoring',
      'The GA4 property for the storefront is 531100373, checked every Monday.',
      { category: 'work', status: 'ongoing', tags: ['ga4', 'analytics'] },
    ),
    context(
      'Shopify store',
      'The Shopify store Robin Keyboard sells mechanical keyboards; its summer sale runs in July.',
      { category: 'work', status: 'ongoing', tags: ['shopify', 'store'] },
    ),
    context(
      'Wedding catering',
      'Finalizing a shellfish-free wedding menu with the caterer before June.',
      { category: 'personal', status: 'ongoing', tags: ['wedding', 'menu'] },
    ),
  ],
  identities: [
    {
      details: null,
      memoryCategory: 'professional',
      memoryType: 'fact',
      summary: 'The user works as a pastry chef.',
      tags: ['career'],
      title: 'Pastry chef',
      withIdentity: {
        description: 'Runs the dessert station at a bistro and trains the junior bakers.',
        episodicDate: null,
        extractedLabels: ['culinary'],
        relationship: 'self',
        role: 'pastry chef',
        scoreConfidence: 0.9,
        sourceEvidence: null,
        sourceIds: [],
        type: 'professional',
      },
    },
    {
      details: null,
      memoryCategory: 'health',
      memoryType: 'fact',
      summary: 'Dr. Kim is the allergist.',
      tags: ['health'],
      title: 'Dr. Kim',
      withIdentity: {
        description: 'The allergist, Dr. Kim, who reviews the allergy panel twice a year.',
        episodicDate: null,
        extractedLabels: [],
        relationship: 'friend',
        role: 'allergist',
        scoreConfidence: 0.7,
        sourceEvidence: null,
        sourceIds: [],
        type: 'personal',
      },
    },
  ],
  preferences: [
    preference(
      'Confirmed trading profile',
      'For paper trading, use a maximum of USD 1000 per trade and apply a 5% stop-loss; never place live trades.',
      {
        category: 'finance',
        suggestions: ['Confirm the stop-loss before each order.'],
        tags: ['trading', 'risk'],
        type: 'trading-profile',
      },
    ),
    preference(
      'Newsletter digest preference',
      'Newsletters: a concise Chinese executive summary, exactly three linked sources and a short action list.',
      { category: 'work', tags: ['newsletter', 'digest'], type: 'format' },
    ),
    preference(
      'Code comment preference',
      'When adding code comments, explain only the important logic and skip obvious lines.',
      { category: 'work', tags: ['code', 'review'], type: 'coding' },
    ),
    preference(
      'Risk disclosure preference',
      'Always state the trading risk before suggesting any paper trade.',
      { category: 'finance', tags: ['risk', 'compliance'], type: 'compliance' },
    ),
  ],
  seededAt: SEEDED_AT.toISOString(),
};

type Layer = 'activities' | 'contexts' | 'identities' | 'preferences';
const LAYERS: Layer[] = ['activities', 'contexts', 'identities', 'preferences'];

/** The text that names an entry across both stores (ids differ). */
const keyOf = (layer: Layer, item: Record<string, any>): string =>
  layer === 'preferences'
    ? item.conclusionDirectives
    : layer === 'activities'
      ? item.narrative
      : item.description;

const round = (value: number) => Math.round(value * 1e9) / 1e9;

/** What a reader of the result sees: per layer, the entries in order, their scores and the layer meta. */
const view = (result: SearchMemoryResult) =>
  Object.fromEntries(
    LAYERS.map((layer) => {
      const items = (result[layer] ?? []) as Record<string, any>[];
      const ranking = result.meta?.ranking?.[layer] ?? {};
      return [
        layer,
        {
          meta: result.meta?.layers[layer],
          order: items.map((item) => keyOf(layer, item)),
          scores: Object.fromEntries(
            items.map((item) => [
              keyOf(layer, item),
              Object.fromEntries(
                Object.entries(ranking[item.id] ?? {}).map(([k, v]) => [k, round(v as number)]),
              ),
            ]),
          ),
        },
      ];
    }),
  );

/** The text that names an entry across both stores (ids differ). */
const entryKeys = [
  ...(fixture.preferences ?? []).map((item: any) => item.withPreference.conclusionDirectives),
  ...(fixture.contexts ?? []).map((item: any) => item.withContext.description),
  ...(fixture.activities ?? []).map((item: any) => item.withActivity.narrative),
  ...(fixture.identities ?? []).map((item: any) => item.withIdentity.description),
] as string[];

/**
 * Each entry's clock: the seed time plus a minute per entry, so no two entries
 * tie on recency (the lexical pass orders by it, and a tie's order is the
 * database's to choose). Both stores are pinned to the same clocks.
 */
const clockOf = (key: string) => {
  const index = entryKeys.indexOf(key);
  if (index < 0) throw new Error(`Unknown entry: ${key}`);
  return new Date(SEEDED_AT.getTime() + (index + 1) * 60_000);
};

/** Add the fixture through the account's Memory tool, then pin every row to its entry's clock. */
const seedAccountMemory = async () => {
  const account = new MemoryServerRuntimeService({
    memoryEffort: 'medium',
    memoryModel: new UserMemoryModel(db, userId),
    serverDB: db,
    userId,
  });
  for (const item of fixture.preferences ?? []) await account.addPreferenceMemory(item as any);
  for (const item of fixture.contexts ?? []) await account.addContextMemory(item as any);
  for (const item of fixture.activities ?? []) await account.addActivityMemory(item as any);
  for (const item of fixture.identities ?? []) await account.addIdentityMemory(item as any);

  const layers = [
    { key: userMemoriesPreferences.conclusionDirectives, table: userMemoriesPreferences },
    { key: userMemoriesContexts.description, table: userMemoriesContexts },
    { key: userMemoriesActivities.narrative, table: userMemoriesActivities },
    { key: userMemoriesIdentities.description, table: userMemoriesIdentities },
  ] as const;
  for (const { key, table } of layers) {
    const rows = await db
      .select({ id: table.id, key, memoryIds: sql<string[]>`ARRAY[]::text[]` })
      .from(table);
    for (const row of rows) {
      const at = clockOf(row.key as string);
      const clock = { accessedAt: at, capturedAt: at, createdAt: at, updatedAt: at };
      await db.update(table).set(clock).where(eq(table.id, row.id));
    }
  }
  // Base rows: through the layer rows that point at them.
  const bases = await db
    .select({ id: userMemories.id, layer: userMemories.memoryLayer, summary: userMemories.summary })
    .from(userMemories);
  for (const base of bases) {
    const linked =
      base.layer === 'preference'
        ? await db
            .select({ key: userMemoriesPreferences.conclusionDirectives })
            .from(userMemoriesPreferences)
            .where(eq(userMemoriesPreferences.userMemoryId, base.id))
        : base.layer === 'activity'
          ? await db
              .select({ key: userMemoriesActivities.narrative })
              .from(userMemoriesActivities)
              .where(eq(userMemoriesActivities.userMemoryId, base.id))
          : base.layer === 'identity'
            ? await db
                .select({ key: userMemoriesIdentities.description })
                .from(userMemoriesIdentities)
                .where(eq(userMemoriesIdentities.userMemoryId, base.id))
            : await db
                .select({ key: userMemoriesContexts.description })
                .from(userMemoriesContexts)
                .where(
                  sql`COALESCE(${userMemoriesContexts.userMemoryIds}, '[]'::jsonb) ? ${base.id}`,
                );
    const at = clockOf(linked[0]!.key as string);
    await db
      .update(userMemories)
      .set({ capturedAt: at, createdAt: at, lastAccessedAt: at, updatedAt: at })
      .where(eq(userMemories.id, base.id));
  }
  return account;
};

const seedAttemptMemory = async () => {
  const chain = await setupEvalChain({});
  const service = new AgentEvalMemoryService(db, userId);
  const reference = await service.prepare({
    fixture,
    runId: chain.run.id,
    testCaseId: chain.testCase.id,
    topicId: chain.topic.id,
  });
  const rows = await db
    .select({ id: agentEvalMemories.id, payload: agentEvalMemories.payload })
    .from(agentEvalMemories);
  for (const row of rows) {
    const p = row.payload as Record<string, any>;
    const key = p.conclusionDirectives ?? p.narrative ?? p.description;
    if (typeof key !== 'string') continue;
    const at = clockOf(key);
    await db
      .update(agentEvalMemories)
      .set({ capturedAt: at, createdAt: at, updatedAt: at })
      .where(eq(agentEvalMemories.id, row.id));
  }
  return service.runtime({
    context: { topicId: chain.topic.id },
    memoryEffort: 'medium',
    reference,
  });
};

const LONG_QUERY =
  'Earlier in this conversation the user explained that they are allergic to shellfish and are ' +
  'planning a shellfish-free wedding menu with their caterer; they also mentioned that they only ' +
  'paper trade with a strict stop-loss and like newsletter digests with three linked sources.';

/** `bm25: true` cases send a short query, which the account's search answers through pg_search. */
const cases: Array<{ bm25: boolean; name: string; params: SearchMemoryParams }> = [
  {
    bm25: true,
    name: 'a query at the default effort',
    params: { queries: ['paper trading stop loss'] },
  },
  {
    bm25: true,
    name: 'a hyphenated query at high effort',
    params: { effort: 'high', queries: ['stop-loss before each order'] },
  },
  { bm25: true, name: 'a context query', params: { effort: 'high', queries: ['wedding menu'] } },
  {
    bm25: true,
    name: 'a query on one layer',
    params: { effort: 'high', layers: ['context'], queries: ['GA4'] } as SearchMemoryParams,
  },
  {
    bm25: true,
    name: 'two queries',
    params: { effort: 'high', queries: ['newsletter', 'trading risk'] },
  },
  { bm25: false, name: 'a tag filter and no query', params: { effort: 'high', tags: ['risk'] } },
  {
    bm25: true,
    name: 'a category filter',
    params: { categories: ['health'], effort: 'high', queries: ['allergy'] },
  },
  {
    bm25: true,
    name: 'a status filter on activities',
    params: {
      effort: 'high',
      layers: ['activity'],
      queries: ['appointment'],
      status: ['completed'],
    } as SearchMemoryParams,
  },
  {
    bm25: true,
    name: 'a time intent that covers the seed',
    params: {
      effort: 'high',
      queries: ['dessert'],
      timeIntent: { end: '2024-05-31', selector: 'range', start: '2024-05-01' },
    } as unknown as SearchMemoryParams,
  },
  {
    bm25: true,
    name: 'a time range before the seed',
    params: {
      effort: 'high',
      queries: ['dessert'],
      timeRange: { end: new Date('2023-12-31T00:00:00Z'), start: new Date('2023-01-01T00:00:00Z') },
    },
  },
  { bm25: false, name: 'a query too long for the lexical pass', params: { queries: [LONG_QUERY] } },
  {
    bm25: true,
    name: 'a relationship filter on identities',
    params: { effort: 'high', queries: ['pastry chef'], relationships: ['self'] },
  },
  {
    bm25: true,
    name: 'a type filter',
    params: { effort: 'high', queries: ['trading'], types: ['preference'] },
  },
  { bm25: true, name: 'low effort', params: { effort: 'low', queries: ['keyboards summer sale'] } },
  { bm25: true, name: 'a name in two layers', params: { effort: 'high', queries: ['Dr. Kim'] } },
  {
    bm25: true,
    name: 'a query with a tag filter',
    params: { effort: 'high', queries: ['trading'], tags: ['risk'] },
  },
  {
    bm25: false,
    name: 'a time range and no query',
    params: { effort: 'high', timeRange: { start: new Date('2024-04-30T00:00:00Z') } },
  },
];

/**
 * The attempt's Memory tool must answer exactly as the account's Memory tool
 * answers for the same entries: the same entries per layer, in the same order,
 * with the same scores. The account's side is the product runtime over
 * `user_memories*`; the attempt's side is the eval runtime over
 * `agent_eval_memories`.
 */
describe('eval Memory search parity with the account Memory', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.embed.mockImplementation(async ({ input }: { input: Array<string | null | undefined> }) =>
      input.map((text) => (text ? vectorOf(text) : undefined)),
    );
    await cleanupDB();
  });

  const compare = async (params: SearchMemoryParams) => {
    const account = await seedAccountMemory();
    const attempt = await seedAttemptMemory();

    const expected = view(await account.searchMemory(params));
    const actual = view(await attempt.searchMemory(params));

    expect(actual).toEqual(expected);
    // The case must exercise something: at least one layer returned an entry,
    // unless its time range ends before anything was remembered.
    const returned = LAYERS.reduce((sum, layer) => sum + expected[layer].order.length, 0);
    const beforeSeed = !!params.timeRange?.end && params.timeRange.end < SEEDED_AT;
    if (beforeSeed) expect(returned).toBe(0);
    else expect(returned).toBeGreaterThan(0);
  };

  it.each(cases.filter((c) => !c.bm25))('ranks $name the same', ({ params }) => compare(params));

  it.skipIf(!bm25).each(cases.filter((c) => c.bm25))(
    'ranks $name the same (with the BM25 pass)',
    ({ params }) => compare(params),
  );

  it.skipIf(!bm25)('searches with the lexical pass when pg_search is present', async () => {
    const attempt = await seedAttemptMemory();
    // Words that appear only in the directives: the semantic pass alone (bag of words) would
    // also find it, so check the keyword signal itself.
    const result = await attempt.searchMemory({ effort: 'high', queries: ['live trades'] });
    const top = result.preferences[0] as Record<string, any>;
    expect(top.conclusionDirectives).toContain('never place live trades');
    expect(result.meta?.ranking?.preferences?.[top.id]?.keyword).toBeGreaterThan(0);
  });
});
