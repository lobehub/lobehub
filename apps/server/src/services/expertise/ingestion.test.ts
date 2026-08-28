// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { expertiseHits, expertiseLessons, expertiseRuns } from '@/database/schemas';

import type { SelfIterationCompletionPayload } from '../agentSignal/services/selfIteration/completion';
import { ExpertiseIngestionService, normalizeLessonTitle } from './ingestion';

const { resolveExpertiseModelConfig } = vi.hoisted(() => ({
  resolveExpertiseModelConfig: vi.fn(),
}));
const generateObject = vi.fn();
const listDomainsForAgent = vi.fn();
const listLessons = vi.fn();

vi.mock('@/database/models/expertise', () => ({
  ExpertiseModel: class {
    listDomainsForAgent = listDomainsForAgent;
    listLessons = listLessons;
  },
}));
vi.mock('@/server/services/aiGeneration', () => ({
  AiGenerationService: class {
    generateObject = generateObject;
  },
}));
vi.mock('./modelConfig', () => ({ resolveExpertiseModelConfig }));

const completion = (selfIteration: SelfIterationCompletionPayload) => ({
  agentId: 'agent-signal-reflection',
  operationId: 'op_review_1',
  selfIteration,
});

afterEach(() => vi.restoreAllMocks());

describe('ExpertiseIngestionService.ingestSelfReview', () => {
  it('ingests a topic only after its self-reflection run completes', async () => {
    const service = new ExpertiseIngestionService({} as never, 'user_1');
    const ingestCompletion = vi
      .spyOn(service, 'ingestCompletion')
      .mockResolvedValue({ ingested: 1, reason: 'matched' });

    await service.ingestSelfReview(
      completion({
        artifacts: [],
        marker: {
          agentId: 'agent_1',
          kind: 'self-reflection',
          sourceId: 'reflection_1',
          topicId: 'topic_1',
        },
        mutations: [],
        userId: 'user_1',
      }),
    );

    expect(ingestCompletion).toHaveBeenCalledWith({
      agentId: 'agent_1',
      operationId: 'op_review_1',
      topicId: 'topic_1',
    });
  });

  it('ignores self-iteration modes that are not review windows', async () => {
    const service = new ExpertiseIngestionService({} as never, 'user_1');
    const ingestCompletion = vi.spyOn(service, 'ingestCompletion');

    const result = await service.ingestSelfReview(
      completion({
        artifacts: [],
        marker: { agentId: 'agent_1', kind: 'memory', sourceId: 'memory_1' },
        mutations: [],
        userId: 'user_1',
      }),
    );

    expect(result).toEqual({ ingested: 0, reason: 'not-review' });
    expect(ingestCompletion).not.toHaveBeenCalled();
  });
});

describe('ExpertiseIngestionService historical ingestion', () => {
  it('uses a stable topic key instead of inventing an operation id', async () => {
    const service = new ExpertiseIngestionService({} as never, 'user_1');
    const ingestCompletion = vi
      .spyOn(service, 'ingestCompletion')
      .mockResolvedValue({ ingested: 1, reason: 'matched' });

    await service.ingestHistoricalTopic('agent_1', 'topic_1');

    expect(ingestCompletion).toHaveBeenCalledWith({
      agentId: 'agent_1',
      ingestionKey: 'historical-v1:topic_1',
      topicId: 'topic_1',
    });
  });

  it('processes old topics sequentially to bound model concurrency', async () => {
    const service = new ExpertiseIngestionService({} as never, 'user_1');
    vi.spyOn(service, 'listHistoricalTopics').mockResolvedValue([
      { topicId: 'topic_1' },
      { topicId: 'topic_2' },
    ] as never);
    const ingest = vi
      .spyOn(service, 'ingestHistoricalTopic')
      .mockResolvedValueOnce({ ingested: 1, reason: 'matched' })
      .mockResolvedValueOnce({ ingested: 0, reason: 'no-match' });

    await expect(service.ingestHistory('agent_1')).resolves.toEqual({ ingested: 1, scanned: 2 });
    expect(ingest.mock.calls).toEqual([
      ['agent_1', 'topic_1'],
      ['agent_1', 'topic_2'],
    ]);
  });
});

describe('ExpertiseIngestionService.ingestCompletion', () => {
  it('records expertise ingestion under its own tracing scenario', async () => {
    listDomainsForAgent.mockResolvedValue([
      {
        domain: {
          canonEntries: [],
          domainFilter: 'Production incidents',
          id: 'domain_1',
          layers: [],
          outOfScope: 'Unrelated conversations',
          title: 'Incident response',
        },
      },
    ] as never);
    listLessons.mockResolvedValue([]);
    resolveExpertiseModelConfig.mockResolvedValue({
      model: 'service-model',
      provider: 'service-provider',
    });
    generateObject.mockResolvedValue({ domains: [] });

    await new ExpertiseIngestionService({} as never, 'user_1').ingestCompletion({
      agentId: 'agent_1',
      serializedContext: '[user] Investigate the incident.',
      topicId: 'topic_1',
    });

    expect(generateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'service-model',
        provider: 'service-provider',
      }),
      expect.objectContaining({
        tracing: expect.objectContaining({
          promptVersion: 'v2',
          scenario: 'expertise_topic_ingestion',
        }),
      }),
    );
  });
});

interface TxFake {
  inserted: Map<unknown, Record<string, unknown>[]>;
  tx: unknown;
  updates: Record<string, unknown>[];
}

/**
 * A boundary fake for the persist transaction. `selects` is consumed in call order:
 * domain lock, existing run, max run index, persisted lessons, status counts, layer counts.
 */
const createTx = (persistedLessons: Record<string, unknown>[]): TxFake => {
  const inserted = new Map<unknown, Record<string, unknown>[]>();
  const updates: Record<string, unknown>[] = [];
  const selects = [
    [],
    [],
    [{ value: 0 }],
    persistedLessons,
    [{ active: 1, compiled: 0, retired: 0 }],
    [],
  ];
  let selectIndex = 0;
  const selectChain = () => {
    const result = selects[selectIndex++];
    const chain = {
      from: () => chain,
      for: () => chain,
      groupBy: () => chain,
      limit: () => chain,
      orderBy: () => chain,
      // Drizzle query builders are awaitable thenables; mirror that contract in this boundary fake.
      // eslint-disable-next-line unicorn/no-thenable
      then: (resolve: (value: unknown) => void) => resolve(result),
      where: () => chain,
    };
    return chain;
  };

  return {
    inserted,
    tx: {
      insert: (table: unknown) => ({
        values: async (value: Record<string, unknown>) => {
          inserted.set(table, [...(inserted.get(table) ?? []), value]);
        },
      }),
      select: selectChain,
      update: () => ({
        set: (value: Record<string, unknown>) => ({
          where: async () => {
            updates.push(value);
          },
        }),
      }),
    },
    updates,
  };
};

const observation = (overrides: Record<string, unknown> = {}) => ({
  example: 'Observed evidence',
  existingLessonCode: null,
  layer: null,
  outcome: 'pass' as const,
  reasoning: 'Evidence supports the rule',
  title: 'Ground the conclusion in evidence',
  ...overrides,
});

const persistRun = async (
  fake: TxFake,
  observations: ReturnType<typeof observation>[],
): Promise<void> => {
  const service = new ExpertiseIngestionService(
    {
      transaction: async (callback: (value: unknown) => Promise<void>) => callback(fake.tx),
    } as never,
    'user_1',
  );
  await service['persistDomainRun']({
    agentId: 'agent_1',
    domain: { id: 'domain_1' },
    observations: observations as never,
    operationId: 'operation_1',
    topicId: 'topic_1',
  });
};

describe('normalizeLessonTitle', () => {
  it('ignores the whitespace and case the model rewrites between runs', () => {
    expect(normalizeLessonTitle('  Separate the Runtime  plane ')).toBe(
      normalizeLessonTitle('separate the runtime plane'),
    );
  });

  it('keeps punctuation, which is what separates a rule from its negation', () => {
    expect(normalizeLessonTitle('Retry on timeout')).not.toBe(
      normalizeLessonTitle('Retry on timeout, never on 4xx'),
    );
  });
});

describe('ExpertiseIngestionService.persistDomainRun', () => {
  it('uses the persisted run id for the lesson hit', async () => {
    const fake = createTx([]);
    await persistRun(fake, [observation()]);

    const run = fake.inserted.get(expertiseRuns)?.[0];
    const hit = fake.inserted.get(expertiseHits)?.[0];
    expect(run?.id).toMatch(/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i);
    expect(hit?.runId).toBe(run?.id);
  });

  it('attaches by code when the model returns a real lesson code', async () => {
    const fake = createTx([
      { code: 'P-07', id: 'lesson_7', status: 'active', title: 'Separate the runtime plane' },
    ]);
    await persistRun(fake, [observation({ existingLessonCode: 'P-07', title: 'Something else' })]);

    expect(fake.inserted.get(expertiseLessons)).toBeUndefined();
    expect(fake.inserted.get(expertiseHits)?.[0].lessonId).toBe('lesson_7');
  });

  it('falls back to the title when the model fills the code field with a source snippet', async () => {
    const fake = createTx([
      { code: 'P-07', id: 'lesson_7', status: 'active', title: 'Separate the runtime plane' },
    ]);
    await persistRun(fake, [
      observation({
        existingLessonCode: "if kwargs.get('device_type') == 'mps':\n...",
        title: 'Separate the Runtime Plane',
      }),
    ]);

    expect(fake.inserted.get(expertiseLessons)).toBeUndefined();
    expect(fake.inserted.get(expertiseHits)?.[0].lessonId).toBe('lesson_7');
  });

  it('does not resurrect a lesson the user retired', async () => {
    const fake = createTx([
      { code: 'P-07', id: 'lesson_7', status: 'retired', title: 'Separate the runtime plane' },
    ]);
    await persistRun(fake, [
      observation({ existingLessonCode: 'P-07', title: 'Separate the runtime plane' }),
    ]);

    const lesson = fake.inserted.get(expertiseLessons)?.[0];
    expect(lesson?.title).toBe('Separate the runtime plane');
    // P-07 is taken even while retired, so the new row has to claim the next number.
    expect(lesson?.code).toBe('P-08');
  });

  it('collapses observations that restate the same rule inside one run', async () => {
    const fake = createTx([]);
    await persistRun(fake, [
      observation({ title: 'Separate the runtime plane' }),
      observation({ example: 'Second sighting', title: 'Separate the  runtime plane' }),
    ]);

    expect(fake.inserted.get(expertiseLessons)).toHaveLength(1);
    expect(fake.inserted.get(expertiseHits)).toHaveLength(2);
    const runUpdate = fake.updates.find((update) => 'newCount' in update);
    expect(runUpdate).toMatchObject({ instanceCount: 1, newCount: 1 });
  });
});
