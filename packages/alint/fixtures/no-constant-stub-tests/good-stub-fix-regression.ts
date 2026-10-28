// Fixture: the stub is named in this file, but the test is the regression test for the bug
// that made it report success.
import { expect, it, vi } from 'vitest';

import { groupRuntime } from '../groupManagement';

// `vote` is a placeholder until broadcast voting ships. It used to resolve
// `{ success: true }`, which supervisors read as a cast vote; the fix makes it fail loudly.
it('fails vote explicitly instead of returning the old success-shaped result', async () => {
  const run = vi.fn();
  const runtime = groupRuntime.factory({ agentMember: { run } } as any) as any;

  const result = await runtime.vote({ options: [{ id: 'a', label: 'A' }], question: 'Pick' }, {});

  expect(result.success).toBe(false);
  expect(result.error?.code).toBe('VOTE_NOT_IMPLEMENTED');
});
