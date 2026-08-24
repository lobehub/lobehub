// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { expertiseHits, expertiseLessons, expertiseRuns } from '@/database/schemas';

import type { SelfIterationCompletionPayload } from '../agentSignal/services/selfIteration/completion';
import { ExpertiseIngestionService, normalizeLessonTitle, selectTopicContext } from './ingestion';

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

describe('selectTopicContext', () => {
  const user = (content: string) => ({ content, role: 'user' });
  const assistant = (content: string) => ({ content, role: 'assistant' });
  const tool = (length: number, fill = 'x') => ({ content: fill.repeat(length), role: 'tool' });

  it('drops the empty assistant rows a streaming turn leaves behind', () => {
    const { serialized } = selectTopicContext([
      user('Join the GPU node'),
      { content: '', role: 'assistant' },
      { content: null, role: 'assistant' },
      { content: '   ', role: 'assistant' },
      assistant('Checking the control-plane endpoint'),
    ]);

    expect(serialized).toBe(
      '[user] Join the GPU node\n\n[assistant] Checking the control-plane endpoint',
    );
  });

  it('keeps every user turn of a tool-dominated topic instead of its trailing bytes', () => {
    // The shape that produced the bug: reasoning is a rounding error next to the tool output,
    // so budgeting the raw stream buys tool dumps and loses all but the last question.
    const rows = Array.from({ length: 30 }, (_, index) => [
      user(`question ${index}`),
      assistant(`answer ${index}`),
      tool(36_000),
    ]).flat();

    const { droppedTurns, serialized } = selectTopicContext(rows, 96_000);

    expect(droppedTurns).toBe(0);
    for (let index = 0; index < 30; index += 1) {
      expect(serialized).toContain(`[user] question ${index}`);
      expect(serialized).toContain(`[assistant] answer ${index}`);
    }
    expect(serialized.length).toBeLessThanOrEqual(96_000);
  });

  it('compresses a long tool result to its head and tail rather than dropping it', () => {
    // The command that ran and the error it ended on are what a lesson is drawn from.
    const content = `$ kubeadm join${'listing\n'.repeat(2000)}error: certificate has expired`;
    const { serialized } = selectTopicContext([user('run it'), { content, role: 'tool' }], 2000);

    expect(serialized).toContain('$ kubeadm join');
    expect(serialized).toContain('error: certificate has expired');
    expect(serialized).toContain('…');
    expect(serialized.length).toBeLessThan(content.length / 10);
  });

  it('unwraps the stored content-part envelope instead of slicing its JSON', () => {
    const content = JSON.stringify([
      { text: 'Script completed\nWall time 0.2 seconds\nOutput:\n', type: 'input_text' },
      { text: 'NAME         STATUS\nliet-gpu-1   Ready', type: 'input_text' },
    ]);
    const { serialized } = selectTopicContext([user('list nodes'), { content, role: 'tool' }]);

    expect(serialized).toContain('liet-gpu-1   Ready');
    expect(serialized).not.toContain('input_text');
    expect(serialized).not.toContain(String.raw`\n`);
  });

  it('names a non-text part rather than inlining the payload it carries', () => {
    const content = JSON.stringify([
      { text: 'screenshot taken', type: 'text' },
      { image: `data:image/png;base64,${'A'.repeat(50_000)}`, type: 'image' },
    ]);
    const { serialized } = selectTopicContext([user('look'), { content, role: 'tool' }]);

    expect(serialized).toContain('screenshot taken');
    expect(serialized).toContain('[image]');
    expect(serialized).not.toContain('AAAAAAAA');
  });

  it('leaves typed records alone rather than reducing them to their type names', () => {
    // A tool that returned JSON records satisfies the envelope check but is not an envelope.
    const content = JSON.stringify([
      { id: 1, name: 'node01', type: 'node' },
      { id: 2, name: 'liet-gpu-1', type: 'node' },
    ]);
    const { serialized } = selectTopicContext([user('list'), { content, role: 'tool' }]);

    expect(serialized).toContain('liet-gpu-1');
    expect(serialized).not.toBe('[user] list\n\n[tool] [node]\n[node]');
  });

  it('keeps a failure line buried in the middle of a long result', () => {
    // 65% of the recorded failure markers sit here — neither in the head nor in the tail.
    const content = [
      '$ kubeadm join 10.24.0.2:6443',
      ...Array.from({ length: 400 }, (_, index) => `[preflight] step ${index}`),
      'error: x509: certificate has expired',
      ...Array.from({ length: 400 }, (_, index) => `[preflight] step ${400 + index}`),
      'exit status 1',
    ].join('\n');
    const { serialized } = selectTopicContext([user('join'), { content, role: 'tool' }]);

    expect(serialized).toContain('$ kubeadm join 10.24.0.2:6443');
    expect(serialized).toContain('error: x509: certificate has expired');
    expect(serialized).toContain('exit status 1');
  });

  it('cuts on line boundaries so no line arrives half-read', () => {
    const content = Array.from({ length: 500 }, (_, index) => `line ${index} of output`).join('\n');
    const { serialized } = selectTopicContext([user('run'), { content, role: 'tool' }]);

    const body = serialized.split('[tool] ')[1];
    for (const line of body.split('\n')) {
      expect(line === '…' || /^line \d+ of output$/.test(line)).toBe(true);
    }
  });

  it('drops whole turns oldest-first, keeping the one that states what the user came for', () => {
    const rows = Array.from({ length: 8 }, (_, index) => [
      user(`question ${index}`),
      assistant('a'.repeat(400)),
    ]).flat();

    const { droppedTurns, serialized } = selectTopicContext(rows, 1500);

    expect(droppedTurns).toBeGreaterThan(0);
    // The opening turn survives: it is what a domain filter reads to judge scope.
    expect(serialized).toContain('[user] question 0');
    expect(serialized).toContain('[user] question 7');
    expect(serialized).not.toContain('[user] question 1');
    expect(serialized.length).toBeLessThanOrEqual(1500);
  });

  it('sees a human in the loop even when the user only speaks at the start', () => {
    // A tail window over a long agent-driven topic reports no human at all.
    const rows = [user('kick it off'), ...Array.from({ length: 40 }, () => assistant('working'))];

    expect(selectTopicContext(rows).hadHumanInLoop).toBe(true);
  });
});
