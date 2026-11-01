import type { ExpertiseContextSnapshot } from '@lobechat/types';
import { EXPERTISE_CONTEXT_SCHEMA_VERSION } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { MessagesEngine } from '../../engine/messages';
import { buildExpertiseContextSnapshot } from '../ExpertiseContextInjector';

const snapshot: ExpertiseContextSnapshot = {
  contentHash: 'stable-hash',
  domains: [{ id: 'domain-1', lessonIds: ['lesson-1', 'lesson-2'] }],
  renderedContext: '<expertise>stable operation expertise</expertise>',
  schemaVersion: EXPERTISE_CONTEXT_SCHEMA_VERSION,
};

describe('ExpertiseContextInjector', () => {
  it('builds one stable snapshot from ordered domains and active lessons', async () => {
    const domain = {
      canonEntries: [],
      domainFilter: 'Product decisions',
      flow: ['Define the task'],
      id: 'domain-db-id',
      outOfScope: null,
      slug: 'product-design',
      title: 'Product Design',
    };
    const lessons = [
      {
        code: 'P-01',
        id: 'lesson-1',
        layer: 'L1',
        polarity: 'rule' as const,
        sections: [{ body: 'Start from the user task.', key: 'rule' as const }],
        title: 'Start from the task',
      },
    ];
    const source = {
      listDomainsForAgent: vi.fn().mockResolvedValue([{ domain }]),
      listLessons: vi.fn().mockResolvedValue(lessons),
    };

    const first = await buildExpertiseContextSnapshot(source, 'agent-1');
    const second = await buildExpertiseContextSnapshot(source, 'agent-1');

    expect(first).toEqual(second);
    expect(first?.domains).toEqual([{ id: 'domain-db-id', lessonIds: ['lesson-1'] }]);
    expect(first?.contentHash).toMatch(/^[\da-f]{32}$/);
    expect(first?.schemaVersion).toBe(EXPERTISE_CONTEXT_SCHEMA_VERSION);
  });

  it('returns no snapshot when the agent has no expertise domains', async () => {
    const source = {
      listDomainsForAgent: vi.fn().mockResolvedValue([]),
      listLessons: vi.fn(),
    };

    await expect(buildExpertiseContextSnapshot(source, 'agent-1')).resolves.toBeUndefined();
    expect(source.listLessons).not.toHaveBeenCalled();
  });

  it('injects the operation snapshot before the first user message and records metadata', async () => {
    const result = await new MessagesEngine({
      enableExpertise: true,
      expertise: snapshot,
      messages: [
        {
          content: 'Hello',
          createdAt: 1,
          id: 'user-1',
          role: 'user',
          updatedAt: 1,
        },
      ],
      model: 'test-model',
      provider: 'test-provider',
    }).process();

    expect(result.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          content: expect.stringContaining(snapshot.renderedContext),
          role: 'user',
        }),
      ]),
    );
    expect(result.metadata).toMatchObject({
      expertiseContentHash: 'stable-hash',
      expertiseDomainCount: 1,
      expertiseLessonCount: 2,
    });
  });

  it('does not inject an available snapshot when expertise is disabled', async () => {
    const result = await new MessagesEngine({
      enableExpertise: false,
      expertise: snapshot,
      messages: [
        {
          content: 'Hello',
          createdAt: 1,
          id: 'user-1',
          role: 'user',
          updatedAt: 1,
        },
      ],
      model: 'test-model',
      provider: 'test-provider',
    }).process();

    expect(result.messages.some(({ content }) => String(content).includes('<expertise>'))).toBe(
      false,
    );
    expect(result.metadata).not.toHaveProperty('expertiseContentHash');
  });

  it('does not add a context message without a snapshot', async () => {
    const result = await new MessagesEngine({
      enableExpertise: true,
      messages: [
        {
          content: 'Hello',
          createdAt: 1,
          id: 'user-1',
          role: 'user',
          updatedAt: 1,
        },
      ],
      model: 'test-model',
      provider: 'test-provider',
    }).process();

    expect(result.messages.some(({ content }) => String(content).includes('<expertise>'))).toBe(
      false,
    );
  });
});
