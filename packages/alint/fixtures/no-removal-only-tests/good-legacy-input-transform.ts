import { expect, it } from 'vitest';

import { normalizeTaskInput } from './normalize';

it('strips retired fields from old inputs and preserves the supported instruction', () => {
  const task = normalizeTaskInput({ instruction: 'Launch', legacyProjectAlias: 'OLD' });
  expect(task).not.toHaveProperty('legacyProjectAlias');
  expect(task.instruction).toBe('Launch');
});
