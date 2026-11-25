import { expect, it, vi } from 'vitest';

import { persistSelectedContext } from './persistSelectedContext';

it('persists explicit selections once and keeps an existing persisted body on regeneration', async () => {
  const message = {
    id: 'u1',
    role: 'user',
    content: 'review',
    metadata: { selectedSkillIds: ['review'], selectedToolIds: ['search'] },
  };
  const update = vi.fn(async () => ({ success: true }));
  const options = {
    message,
    update,
    skills: [{ identifier: 'review', name: 'Review', content: 'EXACT SKILL' }],
    manifests: [
      { identifier: 'search', api: [], systemRole: 'EXACT TOOL', type: 'builtin' as const },
    ],
  };
  await persistSelectedContext(options);
  expect(message.content.match(/EXACT SKILL/g)).toHaveLength(1);
  expect(message.content.match(/EXACT TOOL/g)).toHaveLength(1);
  await persistSelectedContext({
    ...options,
    skills: [{ identifier: 'review', name: 'Review', content: 'CHANGED' }],
  });
  expect(update).toHaveBeenCalledTimes(1);
  expect(message.content).not.toContain('CHANGED');
});

it('does not update the in-memory input or dispatch after a failed persistence', async () => {
  const message = {
    id: 'u1',
    role: 'user',
    content: 'review',
    metadata: { selectedSkillIds: ['review'] },
  };
  await expect(
    persistSelectedContext({
      message,
      update: async () => ({ success: false }),
      skills: [{ identifier: 'review', name: 'Review', content: 'body' }],
    }),
  ).rejects.toThrow();
  expect(message.content).toBe('review');
});
