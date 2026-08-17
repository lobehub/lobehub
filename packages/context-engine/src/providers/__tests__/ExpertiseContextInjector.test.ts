import type { ExpertiseContextSnapshot } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { MessagesEngine } from '../../engine/messages';

const snapshot: ExpertiseContextSnapshot = {
  contentHash: 'stable-hash',
  domains: [{ id: 'domain-1', lessonIds: ['lesson-1', 'lesson-2'] }],
  renderedContext: '<expertise>stable operation expertise</expertise>',
  schemaVersion: 1,
};

describe('ExpertiseContextInjector', () => {
  it('injects the operation snapshot before the first user message and records metadata', async () => {
    const result = await new MessagesEngine({
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

  it('does not add a context message without a snapshot', async () => {
    const result = await new MessagesEngine({
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
