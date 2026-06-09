import { scoreDomainProcedureBatch } from '../batchScorer';

describe('Domain procedure batch scorer', () => {
  /**
   * @example
   * context-only direct tool records receive zero handling pressure.
   */
  it('keeps context-only direct tool records below handling threshold', () => {
    const result = scoreDomainProcedureBatch({
      bucket: {
        bucketKey: 'topic:t1:memory',
        cheapScore: 0,
        domain: 'memory',
        firstSeenAt: 100,
        lastSeenAt: 100,
        recordCount: 1,
        recordIds: ['record_1'],
        scopeKey: 'topic:t1',
        version: '1',
      },
      now: 120,
      records: [
        {
          accumulatorRole: 'context',
          createdAt: 100,
          domainKey: 'memory:user-preference',
          id: 'record_1',
          refs: {},
          scopeKey: 'topic:t1',
          status: 'handled',
        },
      ],
    });

    expect(result.aggregateScore).toBe(0);
    expect(result.suggestedActions).toEqual([]);
  });

  /**
   * @example
   * candidate weak records can cross a domain bucket threshold.
   */
  it('scores candidate weak records into maintain suggestions', () => {
    const result = scoreDomainProcedureBatch({
      bucket: {
        bucketKey: 'topic:t1:skill',
        cheapScore: 1.2,
        domain: 'skill',
        firstSeenAt: 100,
        lastSeenAt: 130,
        recordCount: 2,
        recordIds: ['a', 'b'],
        scopeKey: 'topic:t1',
        version: '1',
      },
      now: 140,
      records: [
        {
          accumulatorRole: 'candidate',
          cheapScoreDelta: 0.6,
          createdAt: 100,
          domainKey: 'skill',
          id: 'a',
          refs: {},
          scopeKey: 'topic:t1',
          status: 'observed',
        },
        {
          accumulatorRole: 'candidate',
          cheapScoreDelta: 0.6,
          createdAt: 130,
          domainKey: 'skill',
          id: 'b',
          refs: {},
          scopeKey: 'topic:t1',
          status: 'observed',
        },
      ],
    });

    expect(result.aggregateScore).toBeGreaterThanOrEqual(1);
    expect(result.suggestedActions).toContain('maintain');
  });
});
