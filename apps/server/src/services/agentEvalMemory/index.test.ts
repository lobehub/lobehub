// @vitest-environment node
import type { EvalMemoryFixture } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { AgentEvalRunTopicModel } from '@/database/models/agentEval';
import { UserMemoryPreferenceModel } from '@/database/models/userMemory/preference';
import {
  agentEvalMemories,
  agentEvalRuns,
  agentEvalRunTopics,
  messages,
  threads,
  topics,
  users,
  workspaces,
} from '@/database/schemas';
import { cleanupDB, setupEvalChain, userId } from '@/server/services/agentEvalRun/__tests__/_setup';
import { getEvalAttemptId } from '@/server/services/agentEvalRun/utils';
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
      // A preference's type is its memory type, as the account's Memory stores it.
      type: 'preference',
    });
    expect(state.contexts[0]).toMatchObject({ currentStatus: 'ongoing', title: 'Wedding menu' });
    expect(state.activities[0]).toMatchObject({
      startsAt: new Date('2024-05-03T14:00:00Z'),
      status: 'completed',
    });
    // Experience memory is retired: the account's search never returns it either.
    expect(state.experiences).toEqual([]);
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

  it("lets the sub-agents a pass@k attempt spawned use that attempt's Memory, never a sibling's", async () => {
    const params = await trial();
    const service = new AgentEvalMemoryService(db, userId);
    const thread = (title: string, extra: Record<string, unknown> = {}) =>
      db
        .insert(threads)
        .values({ title, topicId: params.topicId, type: 'eval', userId, ...extra } as any)
        .returning()
        .then(([row]) => row as { id: string });
    // A sub-agent runs in an isolation thread hanging off the tool message that started it.
    const spawnFrom = async (parentThreadId: string, title: string) => {
      const [message] = (await db
        .insert(messages)
        .values({ role: 'tool', threadId: parentThreadId, topicId: params.topicId, userId } as any)
        .returning()) as Array<{ id: string }>;
      return thread(title, { sourceMessageId: message.id, type: 'isolation' });
    };
    const attempt = await thread('attempt');
    const sibling = await thread('sibling');
    const reference = await service.prepare({ ...params, fixture, threadId: attempt.id });
    await service.prepare({ ...params, fixture: {}, threadId: sibling.id });

    const subAgent = await spawnFrom(attempt.id, 'sub-agent');
    const nested = await spawnFrom(subAgent.id, 'nested sub-agent');
    for (const threadId of [subAgent.id, nested.id]) {
      const runtime = await runtimeFor(reference, params.topicId, { threadId });
      expect((await runtime.searchUserMemory({ queries: ['shellfish'] })).state).toMatchObject({
        preferences: [{ conclusionDirectives: 'Do not recommend shellfish.' }],
      });
    }

    const siblingSubAgent = await spawnFrom(sibling.id, "sibling's sub-agent");
    await expect(
      runtimeFor(reference, params.topicId, { threadId: siblingSubAgent.id }),
    ).rejects.toThrow('another attempt');
    // An ordinary thread of the topic is not a sub-agent of the attempt either.
    await expect(runtimeFor(reference, params.topicId, { threadId: sibling.id })).rejects.toThrow(
      'another attempt',
    );
  });

  it('keeps retained deleted-thread memories out of the parent and live sibling attempts', async () => {
    const params = await trial();
    const service = new AgentEvalMemoryService(db, userId);
    const [deletedThread, liveThread] = await db
      .insert(threads)
      .values([
        { title: 'Deleted attempt', topicId: params.topicId, type: 'eval', userId },
        { title: 'Live attempt', topicId: params.topicId, type: 'eval', userId },
      ])
      .returning();
    const parentRef = await service.prepare({
      ...params,
      fixture: { preferences: [preference('Parent tea', 'Parent tea only.')] },
    });
    const deletedRef = await service.prepare({
      ...params,
      fixture: { preferences: [preference('Deleted tea', 'Deleted tea only.')] },
      threadId: deletedThread.id,
    });
    const siblingParams = { ...params, threadId: liveThread.id };
    const siblingRef = await service.prepare({
      ...siblingParams,
      fixture: { preferences: [preference('Sibling tea', 'Sibling tea only.')] },
    });
    const stored = await db.select().from(agentEvalMemories);
    expect(stored.map((row) => row.attemptId).sort()).toEqual(
      [parentRef, deletedRef, siblingRef].map(getEvalAttemptId).sort(),
    );
    const retained = stored.find((row) => row.threadId === deletedThread.id)!;

    await db.delete(threads).where(eq(threads.id, deletedThread.id));
    expect(
      await db.select().from(agentEvalMemories).where(eq(agentEvalMemories.id, retained.id)),
    ).toEqual([{ ...retained, threadId: null }]);
    await expect(service.snapshot({ ...params, threadId: deletedThread.id })).rejects.toThrow(
      'Eval Memory thread does not belong to this trial',
    );

    const parentRuntime = await runtimeFor(parentRef, params.topicId);
    expect
      .soft((await service.snapshot(params)).entries.map((entry) => entry.title))
      .toEqual(['Parent tea']);
    expect
      .soft((await parentRuntime.searchUserMemory({ queries: ['tea'] })).state)
      .toMatchObject({ preferences: [{ conclusionDirectives: 'Parent tea only.' }] });
    expect
      .soft((await parentRuntime.queryTaxonomyOptions({ include: ['categories'] })).state)
      .toMatchObject({ categories: [{ count: 1, layers: ['preference'], value: 'health' }] });

    const siblingRuntime = await runtimeFor(siblingRef, params.topicId, {
      threadId: liveThread.id,
    });
    expect((await service.snapshot(siblingParams)).entries.map((entry) => entry.title)).toEqual([
      'Sibling tea',
    ]);
    expect((await siblingRuntime.searchUserMemory({ queries: ['tea'] })).state).toMatchObject({
      preferences: [{ conclusionDirectives: 'Sibling tea only.' }],
    });
    expect(
      (await siblingRuntime.queryTaxonomyOptions({ include: ['categories'] })).state,
    ).toMatchObject({ categories: [{ count: 1, layers: ['preference'], value: 'health' }] });
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

  it('keeps empty fixture initialization durable across resume and agent writes', async () => {
    const params = await trial();
    const service = new AgentEvalMemoryService(db, userId);
    const reference = await service.prepare({ ...params, fixture: {} });
    const runtime = await runtimeFor(reference, params.topicId);
    await runtime.addPreferenceMemory(preference('Tea', 'Prefers oolong tea.'));
    await db.update(agentEvalRunTopics).set({ evalResult: null });

    expect(await service.prepare({ ...params, fixture: {}, resume: true })).toEqual(reference);
    await expect(service.prepare({ ...params, fixture })).rejects.toThrow(
      'Cannot change Memory fixture',
    );
    expect((await service.snapshot(params)).entries).toMatchObject([
      { source: 'agent', title: 'Tea' },
    ]);
    expect((await runtime.queryTaxonomyOptions({ include: ['categories'] })).state).toMatchObject({
      categories: [{ count: 1, layers: ['preference'], value: 'health' }],
    });
    expect(
      await service.getPersonaDocument(reference, { topicId: params.topicId }),
    ).toBeUndefined();
  });

  it('resumes known legacy fixture rows but refuses to guess an unrecorded empty fixture', async () => {
    const params = await trial();
    const service = new AgentEvalMemoryService(db, userId);
    await expect(service.prepare({ ...params, fixture: {}, resume: true })).rejects.toThrow(
      'rerun this case instead of resuming',
    );
    expect(await service.snapshot(params)).toMatchObject({ entries: [], fixtureHash: null });
    const reference = await service.prepare({ ...params, fixture });
    // A prior release stored provenance only on nonempty fixture rows.
    await db.update(topics).set({ metadata: null }).where(eq(topics.id, params.topicId));
    expect(await service.prepare({ ...params, fixture, resume: true })).toEqual(reference);
    expect((await service.snapshot(params)).entries).toHaveLength(2);
    expect(mocks.embed).toHaveBeenCalledTimes(1);
  });

  it('keeps agent-written evidence with explicitly unknown legacy fixture provenance', async () => {
    const params = await trial();
    const service = new AgentEvalMemoryService(db, userId);
    const reference = await service.prepare({ ...params, fixture: {} });
    await (
      await runtimeFor(reference, params.topicId)
    ).addPreferenceMemory(preference('Tea', 'Prefers oolong tea.'));
    // Simulate an attempt prepared before empty fixtures had a marker.
    await db.update(topics).set({ metadata: null }).where(eq(topics.id, params.topicId));
    expect(await service.snapshot(params)).toMatchObject({
      entries: [{ source: 'agent', title: 'Tea' }],
      fixtureHash: null,
    });
    await expect(service.prepare({ ...params, fixture: {}, resume: true })).rejects.toThrow(
      'rerun this case instead of resuming',
    );
  });

  it('lets workspace collaborators share the stable attempt owner across all Memory operations', async () => {
    const params = await trial();
    const collaborator = 'eval-memory-collaborator';
    const workspaceId = 'eval-memory-workspace';
    await db.insert(users).values({ id: collaborator });
    await db.insert(workspaces).values({
      id: workspaceId,
      name: 'Eval workspace',
      primaryOwnerId: userId,
      slug: workspaceId,
    });
    await db.update(agentEvalRuns).set({ workspaceId }).where(eq(agentEvalRuns.id, params.runId));
    await db.update(agentEvalRunTopics).set({ workspaceId });
    await db.update(topics).set({ workspaceId, metadata: { evalHistoryTailMessageId: 'keep' } });
    const [thread] = await db
      .insert(threads)
      .values({
        topicId: params.topicId,
        type: 'eval',
        userId: collaborator,
        workspaceId,
      })
      .returning();
    const target = { ...params, threadId: thread.id };
    const service = new AgentEvalMemoryService(db, collaborator, workspaceId);
    const reference = await service.prepare({ ...target, fixture });
    const runtime = await runtimeFor(reference, params.topicId, {
      threadId: thread.id,
      userId: collaborator,
      workspaceId,
    });
    expect((await runtime.searchUserMemory({ queries: ['shellfish'] })).state).toMatchObject({
      preferences: [{ conclusionDirectives: 'Do not recommend shellfish.' }],
    });
    expect(
      await service.getPersonaDocument(reference, { topicId: params.topicId, threadId: thread.id }),
    ).toMatchObject({ persona: 'User is allergic to shellfish.' });
    await runtime.addPreferenceMemory(preference('Tea', 'Prefers oolong tea.'));
    expect(
      await new AgentEvalMemoryService(db, userId, workspaceId).prepare({ ...target, fixture }),
    ).toEqual(reference);
    expect((await service.snapshot(target)).entries).toHaveLength(3);
    expect((await db.select().from(agentEvalMemories)).every((row) => row.userId === userId)).toBe(
      true,
    );
    expect(mocks.initModelRuntimeFromDB.mock.calls.every((call) => call[1] === userId)).toBe(true);
    expect((await db.select().from(topics))[0].metadata?.evalHistoryTailMessageId).toBe('keep');
    await expect(
      new AgentEvalMemoryService(db, collaborator, 'another-workspace').prepare({
        ...target,
        fixture,
      }),
    ).rejects.toThrow('not found');
    await expect(new AgentEvalMemoryService(db, collaborator).snapshot(target)).rejects.toThrow(
      'not found',
    );
  });

  it("uses the new topic creator when a collaborator reruns another member's run", async () => {
    const params = await trial();
    const collaborator = 'eval-memory-rerun-collaborator';
    const workspaceId = 'eval-memory-rerun-workspace';
    await db.insert(users).values({ id: collaborator });
    await db.insert(workspaces).values({
      id: workspaceId,
      name: 'Eval workspace',
      primaryOwnerId: userId,
      slug: workspaceId,
    });
    await db.update(agentEvalRuns).set({ workspaceId }).where(eq(agentEvalRuns.id, params.runId));
    await db.update(agentEvalRunTopics).set({ userId: collaborator, workspaceId });
    await db.update(topics).set({ userId: collaborator, workspaceId });
    const service = new AgentEvalMemoryService(db, userId, workspaceId);
    await service.prepare({ ...params, fixture });
    expect((await service.snapshot(params)).entries).toHaveLength(2);
    expect(
      (await db.select().from(agentEvalMemories)).every((row) => row.userId === collaborator),
    ).toBe(true);
    expect(mocks.initModelRuntimeFromDB.mock.calls.every((call) => call[1] === collaborator)).toBe(
      true,
    );
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

  it('retries a seed embedding after a dropped connection, and fails if it stays down', async () => {
    const params = await trial();
    const service = new AgentEvalMemoryService(db, userId);
    mocks.embed
      .mockRejectedValueOnce(new Error('connection error: ECONNRESET'))
      .mockImplementationOnce(async ({ input }: { input: Array<string | undefined> }) =>
        input.map((text) => (text ? vectorOf(text) : undefined)),
      );
    await service.prepare({ ...params, fixture });
    expect(mocks.embed).toHaveBeenCalledTimes(2);
    const snapshot = await service.snapshot(params);
    expect(snapshot.entries).toHaveLength(2);
    expect(snapshot.retrieval).toBeUndefined();

    const other = await anotherAttempt(params);
    mocks.embed.mockRejectedValue(new Error('connection error: ECONNRESET'));
    await expect(service.prepare({ ...other, fixture })).rejects.toThrow('ECONNRESET');
    expect(await service.snapshot(other)).toMatchObject({ entries: [], fixtureHash: null });
  });

  it('takes the simplified path when the account has no usable embedding model', async () => {
    const params = await trial();
    const service = new AgentEvalMemoryService(db, userId);
    mocks.embed.mockRejectedValue(new Error('invalid api key'));
    const reference = await service.prepare({ ...params, fixture: nativeFixture });

    const runtime = await runtimeFor(reference, params.topicId);
    const added = await runtime.addPreferenceMemory(preference('Tea', 'Prefers oolong tea.'));
    expect(added.success).toBe(true);

    // No vectors anywhere, and the model was asked only once per embedder.
    const rows = await db
      .select({ embedding: agentEvalMemories.embedding })
      .from(agentEvalMemories)
      .where(eq(agentEvalMemories.topicId, params.topicId));
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.every((row) => row.embedding === null)).toBe(true);

    // Every entry is still found: words in the query rank, nothing needs a vector.
    const read = await runtime.searchUserMemory({
      effort: 'high',
      queries: ['what do they drink'],
    });
    expect(read.success).toBe(true);
    const state = read.state as SearchState;
    expect(state.preferences.map((p) => p.conclusionDirectives)).toEqual(
      expect.arrayContaining(['Prefers oolong tea.', 'Do not recommend shellfish.']),
    );
    expect(state.contexts[0]).toMatchObject({ title: 'Wedding menu' });

    const snapshot = await service.snapshot(params);
    expect(snapshot.retrieval).toBe('simplified');
    expect(snapshot.entries.map((e) => e.source)).toContain('agent');
  });

  it('reads a runtime error payload: retries a dropped connection and logs why it cannot embed', async () => {
    const params = await trial();
    const service = new AgentEvalMemoryService(db, userId);
    mocks.embed
      .mockRejectedValueOnce({
        error: { message: 'connection error: ECONNRESET' },
        errorType: 'ProviderBizError',
      })
      .mockImplementationOnce(async ({ input }: { input: Array<string | undefined> }) =>
        input.map((text) => (text ? vectorOf(text) : undefined)),
      );
    await service.prepare({ ...params, fixture });
    expect(mocks.embed).toHaveBeenCalledTimes(2);
    expect((await service.snapshot(params)).retrieval).toBeUndefined();

    const other = await anotherAttempt(params);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.embed.mockRejectedValue({
      error: { message: 'Incorrect API key provided' },
      errorType: 'InvalidProviderAPIKey',
    });
    await service.prepare({ ...other, fixture });
    const reason = (warn.mock.calls.at(-1)?.[1] as { reason: string }).reason;
    expect(reason).toContain('InvalidProviderAPIKey');
    expect(reason).not.toContain('[object Object]');
    warn.mockRestore();
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
