import { describe, expect, it, vi } from 'vitest';

import { ExpertiseContextService } from './context';

const domain = {
  canonEntries: [
    {
      key: 'JTBD',
      source: 'Jobs to Be Done',
      statement: 'Start from the user task.',
      title: 'User task',
    },
  ],
  domainFilter: ' Product   decisions ',
  flow: ['Define the task', 'Verify the outcome'],
  id: 'domain-db-id',
  lessons: [
    {
      code: 'P-01',
      id: 'lesson-1',
      layer: 'L1',
      polarity: 'bad' as const,
      sections: [
        { body: 'Start from features.', key: 'wrong' as const },
        { body: 'Define the user task first.', key: 'correct' as const },
      ],
      title: 'Feature accumulation is not value',
    },
  ],
  outOfScope: 'Pure visual preference',
  slug: 'product-design',
  title: 'Product "Design"',
};

describe('ExpertiseContextService', () => {
  it('captures ordered bindings and active lessons into one immutable snapshot', async () => {
    const model = {
      listDomainsForAgent: vi
        .fn()
        .mockResolvedValue([{ binding: {} as never, domain: domain as never }]),
      listLessons: vi.fn().mockResolvedValue(domain.lessons as never),
    };

    const service = new ExpertiseContextService({} as never, 'user-1', undefined, model);
    const first = await service.buildSnapshot('agent-1');
    const second = await service.buildSnapshot('agent-1');

    expect(first).toEqual(second);
    expect(first?.domains).toEqual([{ id: 'domain-db-id', lessonIds: ['lesson-1'] }]);
    expect(first?.contentHash).toMatch(/^[\da-f]{64}$/);
    expect(first?.schemaVersion).toBe(1);
  });
});
