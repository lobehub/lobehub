// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { expertiseHits, expertiseRuns } from '@/database/schemas';

import type { SelfIterationCompletionPayload } from '../agentSignal/services/selfIteration/completion';
import { ExpertiseIngestionService } from './ingestion';

const completion = (selfIteration: SelfIterationCompletionPayload) => ({
  agentId: 'agent-signal-reflection',
  operationId: 'op_review_1',
  selfIteration,
});

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

describe('ExpertiseIngestionService.persistDomainRun', () => {
  it('uses the persisted run id for the lesson hit', async () => {
    const inserted = new Map<unknown, Record<string, unknown>[]>();
    const selectResults = [
      [],
      [],
      [{ value: 0 }],
      [],
      [{ active: 1, compiled: 0, retired: 0 }],
      [],
    ];
    let selectIndex = 0;
    const selectChain = () => {
      const result = selectResults[selectIndex++];
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
    const tx = {
      insert: (table: unknown) => ({
        values: async (value: Record<string, unknown>) => {
          inserted.set(table, [...(inserted.get(table) ?? []), value]);
        },
      }),
      select: selectChain,
      update: () => ({ set: () => ({ where: async () => undefined }) }),
    };
    const service = new ExpertiseIngestionService(
      {
        transaction: async (callback: (value: typeof tx) => Promise<void>) => callback(tx),
      } as never,
      'user_1',
    );

    await service['persistDomainRun']({
      agentId: 'agent_1',
      domain: { id: 'domain_1', lessons: [] },
      observations: [
        {
          example: 'Observed evidence',
          existingCode: null,
          layer: null,
          outcome: 'pass',
          reasoning: 'Evidence supports the rule',
          title: 'Ground the conclusion in evidence',
        },
      ],
      operationId: 'operation_1',
      topicId: 'topic_1',
    });

    const run = inserted.get(expertiseRuns)?.[0];
    const hit = inserted.get(expertiseHits)?.[0];
    expect(run?.id).toMatch(/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i);
    expect(hit?.runId).toBe(run?.id);
  });
});
