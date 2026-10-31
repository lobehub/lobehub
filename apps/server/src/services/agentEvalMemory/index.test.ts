// @vitest-environment node
import type { EvalMemoryFixture } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { AgentEvalRunTopicModel } from '@/database/models/agentEval';
import { UserMemoryPreferenceModel } from '@/database/models/userMemory/preference';
import { agentEvalMemories, topics, users } from '@/database/schemas';
import { cleanupDB, setupEvalChain, userId } from '@/server/services/agentEvalRun/__tests__/_setup';
import { memoryRuntime } from '@/server/services/toolExecution/serverRuntimes/memory';

import { AgentEvalMemoryService } from './index';

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

/** A bag-of-words embedding: texts that share words are close, so ranking is lexical. */
const vectorOf = (text: string) => {
  const vector = Array.from({ length: 1024 }, () => 0);
  for (const token of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (token.length < 2) continue;
    let hash = 0;
    for (const char of token) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 1024;
    vector[hash] += 1;
  }
  return vector;
};

const preference = (title: string, directive: string) => ({
  details: directive,
  memoryCategory: 'health',
  memoryType: 'preference',
  sourceIds: [],
  summary: title,
  tags: ['food'],
  title,
  withPreference: {
    appContext: null,
    conclusionDirectives: directive,
    extractedLabels: [],
    extractedScopes: [],
    originContext: null,
    scorePriority: 1,
    suggestions: [],
    type: 'health',
  },
});

const fixture: EvalMemoryFixture = {
  persona: { narrative: 'User is allergic to shellfish.', tagline: 'Food restrictions' },
  preferences: [preference('No shellfish', 'Do not recommend shellfish.')],
  seededAt: '2024-05-01T12:00:00.000Z',
};

/** One entry per remaining layer, layered on the persona + preference fixture. */
const nativeFixture: EvalMemoryFixture = {
  ...fixture,
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
        narrative: 'User reviewed allergy panel results with Dr. Kim.',
        notes: null,
        startsAt: '2024-05-03T14:00:00Z',
        status: 'completed',
        tags: ['health'],
        timezone: 'UTC',
        type: 'appointment',
      },
    },
  ],
  contexts: [
    {
      details: 'Planning a shellfish-free wedding menu with the caterer.',
      memoryCategory: 'personal',
      memoryType: 'context',
      sourceIds: [],
      summary: 'Wedding menu planning',
      tags: ['wedding'],
      title: 'Wedding catering',
      withContext: {
        associatedObjects: [{ extra: null, name: 'Catering contract', type: 'item' }],
        associatedSubjects: [{ extra: null, name: 'Caterer', type: 'person' }],
        currentStatus: 'ongoing',
        description: 'The user is finalizing a shellfish-free menu for their wedding.',
        labels: ['wedding', 'menu'],
        scoreImpact: 0.8,
        scoreUrgency: 0.6,
        title: 'Wedding menu',
        type: 'project',
      },
    },
  ],
  experiences: [
    {
      details: 'Reacted to hidden shrimp paste in a sauce.',
      memoryCategory: 'health',
      memoryType: 'other',
      sourceIds: [],
      summary: 'Learned to ask about sauces',
      tags: ['dining'],
      title: 'Hidden shellfish in sauces',
      withExperience: {
        action: 'Asked the kitchen for ingredient lists.',
        keyLearning: 'Always ask about sauce bases.',
        knowledgeValueScore: 0.7,
        labels: ['allergy'],
        possibleOutcome: 'Fewer accidental exposures.',
        problemSolvingScore: 0.8,
        reasoning: 'Shrimp paste is a common hidden ingredient.',
        scoreConfidence: 0.9,
        situation: 'Had a reaction at a Thai restaurant.',
        type: 'lesson',
      },
    },
  ],
  identities: [
    {
      details: null,
      memoryCategory: 'professional',
      memoryType: 'fact',
      summary: 'User works as a pastry chef.',
      tags: ['career'],
      title: 'Pastry chef',
      withIdentity: {
        description: 'Runs the dessert station at a bistro.',
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
  ],
};

const trial = async () => {
  const chain = await setupEvalChain({});
  return { runId: chain.run.id, testCaseId: chain.testCase.id, topicId: chain.topic.id };
};

/** Another attempt of the same run and case: its own topic, so its own Memory. */
const anotherAttempt = async (of: { runId: string; testCaseId: string }) => {
  const [topic] = await db
    .insert(topics)
    .values({ title: 'Eval Topic 2', trigger: 'eval', userId })
    .returning();
  await new AgentEvalRunTopicModel(db, userId).batchCreate([
    { runId: of.runId, testCaseId: of.testCaseId, topicId: topic.id },
  ]);
  return { ...of, topicId: topic.id };
};

const runtimeFor = (
  reference: Awaited<ReturnType<AgentEvalMemoryService['prepare']>>,
  topicId: string,
  extra: Record<string, unknown> = {},
) =>
  memoryRuntime.factory({
    evalMemory: reference,
    isEval: true,
    serverDB: db,
    toolManifestMap: {},
    topicId,
    userId,
    ...extra,
  } as any);

type SearchState = {
  activities: Record<string, any>[];
  contexts: Record<string, any>[];
  experiences: Record<string, any>[];
  identities?: Record<string, any>[];
  preferences: Record<string, any>[];
};

describe('AgentEvalMemoryService', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.embed.mockImplementation(async ({ input }: { input: Array<string | null | undefined> }) =>
      input.map((text) => (text ? vectorOf(text) : undefined)),
    );
    await cleanupDB();
  });

  it("seeds the fixture as the attempt's own entries and finds them through the Memory tool", async () => {
    const params = await trial();
    const service = new AgentEvalMemoryService(db, userId);
    const reference = await service.prepare({ ...params, fixture: nativeFixture });
    expect(reference).toEqual({
      fixtureHash: expect.any(String),
      runId: params.runId,
      topicId: params.topicId,
    });

    // Nothing but the caller exists as a user; the caller's own Memory is untouched.
    expect(await db.select({ id: users.id }).from(users)).toEqual([{ id: userId }]);
    expect(await new UserMemoryPreferenceModel(db, userId).query()).toHaveLength(0);

    const runtime = await runtimeFor(reference, params.topicId);
    const read = await runtime.searchUserMemory({ effort: 'high', queries: ['shellfish'] });
    expect(read.success).toBe(true);
    const state = read.state as SearchState;
    expect(state.preferences).toHaveLength(1);
    expect(state.preferences[0]).toMatchObject({
      conclusionDirectives: 'Do not recommend shellfish.',
      createdAt: new Date('2024-05-01T12:00:00.000Z'),
      type: 'health',
    });
    expect(state.contexts[0]).toMatchObject({ currentStatus: 'ongoing', title: 'Wedding menu' });
    expect(state.activities[0]).toMatchObject({
      startsAt: new Date('2024-05-03T14:00:00Z'),
      status: 'completed',
    });
    expect(state.experiences[0]).toMatchObject({ keyLearning: 'Always ask about sauce bases.' });
    expect(state.identities?.[0]).toMatchObject({ role: 'pastry chef', relationship: 'self' });
    expect(read.content).toContain('Do not recommend shellfish.');

    const snapshot = await service.snapshot(params);
    expect(snapshot.fixtureHash).toBe(reference.fixtureHash);
    expect(snapshot.entries.map((e) => e.layer)).toEqual([
      'persona',
      'preference',
      'context',
      'activity',
      'experience',
      'identity',
    ]);
    expect(snapshot.entries.every((e) => e.source === 'fixture')).toBe(true);
    expect(snapshot.entries.every((e) => e.capturedAt === '2024-05-01T12:00:00.000Z')).toBe(true);
    // Vectors never leave the table.
    expect(JSON.stringify(snapshot)).not.toContain('embedding');
  });

  it("reads the persona from the fixture and refuses another trial's reference", async () => {
    const params = await trial();
    const service = new AgentEvalMemoryService(db, userId);
    const reference = await service.prepare({ ...params, fixture });
    expect(await service.getPersonaDocument(reference, { topicId: params.topicId })).toEqual({
      persona: 'User is allergic to shellfish.',
      tagline: 'Food restrictions',
      version: 0,
    });
    const [other] = await db
      .insert(topics)
      .values({ title: 'Other', trigger: 'eval', userId })
      .returning();
    await expect(service.getPersonaDocument(reference, { topicId: other.id })).rejects.toThrow(
      'another trial',
    );
    await expect(runtimeFor(reference, other.id)).rejects.toThrow('another trial');
    // An eval attempt without a reference must not fall back to the caller's Memory.
    await expect(
      memoryRuntime.factory({ isEval: true, serverDB: db, toolManifestMap: {}, userId } as any),
    ).rejects.toThrow('attempt reference');
  });

  it('keeps what the Agent writes inside its own attempt', async () => {
    const a = await trial();
    const b = await anotherAttempt(a);
    const service = new AgentEvalMemoryService(db, userId);
    const refA = await service.prepare({ ...a, fixture: {} });
    const refB = await service.prepare({ ...b, fixture: {} });
    const runtimeA = await runtimeFor(refA, a.topicId);
    const written = await runtimeA.addPreferenceMemory(preference('Tea', 'Prefers oolong tea.'));
    expect(written.success).toBe(true);
    expect((await runtimeA.searchUserMemory({ queries: ['oolong tea'] })).state).toMatchObject({
      preferences: [{ conclusionDirectives: 'Prefers oolong tea.' }],
    });
    const runtimeB = await runtimeFor(refB, b.topicId);
    expect((await runtimeB.searchUserMemory({ queries: ['oolong tea'] })).state).toMatchObject({
      preferences: [],
    });
    expect((await service.snapshot(a)).entries).toMatchObject([
      { layer: 'preference', source: 'agent', title: 'Tea' },
    ]);
    expect((await service.snapshot(b)).entries).toEqual([]);
    expect(await new UserMemoryPreferenceModel(db, userId).query()).toHaveLength(0);
  });

  it("gives each pass@k thread its own Memory and lets a sub-agent thread use its topic's", async () => {
    const params = await trial();
    const service = new AgentEvalMemoryService(db, userId);
    const { threads } = await import('@/database/schemas');
    const [thread1] = (await db
      .insert(threads)
      .values({ title: 't1', topicId: params.topicId, type: 'eval', userId } as any)
      .returning()) as Array<{ id: string }>;
    const [thread2] = (await db
      .insert(threads)
      .values({ title: 't2', topicId: params.topicId, type: 'eval', userId } as any)
      .returning()) as Array<{ id: string }>;
    const ref1 = await service.prepare({ ...params, fixture, threadId: thread1.id });
    const ref2 = await service.prepare({ ...params, fixture: {}, threadId: thread2.id });
    const runtime1 = await runtimeFor(ref1, params.topicId, { threadId: thread1.id });
    expect((await runtime1.searchUserMemory({ queries: ['shellfish'] })).state).toMatchObject({
      preferences: [{ conclusionDirectives: 'Do not recommend shellfish.' }],
    });
    const runtime2 = await runtimeFor(ref2, params.topicId, { threadId: thread2.id });
    expect((await runtime2.searchUserMemory({ queries: ['shellfish'] })).state).toMatchObject({
      preferences: [],
    });
    // A thread reference resolves only from its own thread.
    await expect(runtimeFor(ref1, params.topicId, { threadId: thread2.id })).rejects.toThrow(
      'another attempt',
    );
    // A topic-level attempt is shared with the isolation threads its sub-agents run in.
    const topicRef = await service.prepare({ ...params, fixture });
    const subAgent = await runtimeFor(topicRef, params.topicId, { threadId: thread1.id });
    expect((await subAgent.searchUserMemory({ queries: ['shellfish'] })).state).toMatchObject({
      preferences: [{ conclusionDirectives: 'Do not recommend shellfish.' }],
    });
  });

  it('honors read-only mode', async () => {
    const params = await trial();
    const service = new AgentEvalMemoryService(db, userId);
    const reference = await service.prepare({ ...params, fixture: {} });
    const readOnly = await runtimeFor(reference, params.topicId, {
      memoryToolPermission: 'read-only',
    });
    expect(await readOnly.addPreferenceMemory(preference('Tea', 'Prefers tea.'))).toMatchObject({
      success: false,
    });
    expect((await service.snapshot(params)).entries).toEqual([]);
  });

  it('preserves writes on resume and rejects a changed fixture', async () => {
    const params = await trial();
    const service = new AgentEvalMemoryService(db, userId);
    const reference = await service.prepare({ ...params, fixture });
    const runtime = await runtimeFor(reference, params.topicId);
    await runtime.addPreferenceMemory(preference('Tea', 'Prefers oolong tea.'));
    expect(await service.prepare({ ...params, fixture })).toEqual(reference);
    expect((await service.snapshot(params)).entries).toHaveLength(3);
    await expect(
      service.prepare({ ...params, fixture: { ...fixture, persona: undefined } }),
    ).rejects.toThrow('Cannot change Memory fixture');
  });

  it('updates and removes identities, keeping removed ones as evidence', async () => {
    const params = await trial();
    const service = new AgentEvalMemoryService(db, userId);
    const reference = await service.prepare({ ...params, fixture: nativeFixture });
    const runtime = await runtimeFor(reference, params.topicId);
    const identity = (await service.snapshot(params)).entries.find((e) => e.layer === 'identity')!;
    const updated = await runtime.updateIdentityMemory({
      id: identity.id,
      mergeStrategy: 'merge',
      set: { withIdentity: { role: 'head pastry chef' } },
    } as any);
    expect(updated.success).toBe(true);
    const search = (await runtime.searchUserMemory({ queries: ['pastry chef'] }))
      .state as SearchState;
    expect(search.identities?.[0]).toMatchObject({
      description: 'Runs the dessert station at a bistro.',
      role: 'head pastry chef',
    });
    expect(
      await runtime.removeIdentityMemory({ id: identity.id, reason: 'Changed jobs.' }),
    ).toMatchObject({ success: true });
    expect(
      ((await runtime.searchUserMemory({ queries: ['pastry chef'] })).state as SearchState)
        .identities,
    ).toEqual([]);
    expect(
      (await service.snapshot(params)).entries.find((e) => e.id === identity.id),
    ).toMatchObject({
      removedReason: 'Changed jobs.',
    });
    expect(await runtime.removeIdentityMemory({ id: 'missing', reason: 'x' })).toMatchObject({
      success: false,
    });
  });

  it('filters by facets and time, and lists the taxonomy of what the attempt holds', async () => {
    const params = await trial();
    const service = new AgentEvalMemoryService(db, userId);
    const reference = await service.prepare({ ...params, fixture: nativeFixture });
    const runtime = await runtimeFor(reference, params.topicId);
    const before = (
      await runtime.searchUserMemory({
        effort: 'high',
        timeRange: { end: new Date('2024-04-30T00:00:00Z') },
      })
    ).state as SearchState;
    expect(before.preferences).toEqual([]);
    const after = (
      await runtime.searchUserMemory({
        effort: 'high',
        timeRange: { start: new Date('2024-04-30T00:00:00Z') },
      })
    ).state as SearchState;
    expect(after.preferences).toHaveLength(1);
    expect(after.contexts).toHaveLength(1);
    const tagged = (await runtime.searchUserMemory({ effort: 'high', tags: ['wedding'] }))
      .state as SearchState;
    expect(tagged.contexts).toHaveLength(1);
    expect(tagged.preferences).toEqual([]);
    const taxonomy = await runtime.queryTaxonomyOptions({ include: ['categories', 'tags'] });
    expect(taxonomy.success).toBe(true);
    expect(taxonomy.state).toMatchObject({
      categories: expect.arrayContaining([
        { count: 3, layers: expect.any(Array), value: 'health' },
      ]),
      tags: expect.arrayContaining([{ count: 1, layers: ['context'], value: 'wedding' }]),
      types: [],
    });
  });

  it('retries a seed embedding after a dropped connection, but not other failures', async () => {
    const params = await trial();
    const service = new AgentEvalMemoryService(db, userId);
    mocks.embed
      .mockRejectedValueOnce(new Error('connection error: ECONNRESET'))
      .mockImplementationOnce(async ({ input }: { input: string[] }) => input.map(vectorOf));
    await service.prepare({ ...params, fixture });
    expect(mocks.embed).toHaveBeenCalledTimes(2);
    expect((await service.snapshot(params)).entries).toHaveLength(2);

    const other = await anotherAttempt(params);
    mocks.embed.mockRejectedValueOnce(new Error('invalid api key'));
    await expect(service.prepare({ ...other, fixture })).rejects.toThrow('invalid api key');
    expect((await service.snapshot(other)).entries).toEqual([]);
  });

  it('rejects oversized fixtures, foreign trials and non-eval topics before writing', async () => {
    const params = await trial();
    const service = new AgentEvalMemoryService(db, userId);
    const preferences = Array.from({ length: 51 }, (_, i) => preference(`p${i}`, `d${i}`));
    await expect(service.prepare({ ...params, fixture: { preferences } })).rejects.toThrow(
      '50 entries',
    );
    await expect(
      new AgentEvalMemoryService(db, 'someone-else').prepare({ ...params, fixture }),
    ).rejects.toThrow('not owned');
    await db
      .update(topics)
      .set({ trigger: 'manual' as any })
      .where(eq(topics.id, params.topicId));
    await expect(service.prepare({ ...params, fixture })).rejects.toThrow('not found');
    expect(await db.select().from(agentEvalMemories)).toEqual([]);
  });
});
