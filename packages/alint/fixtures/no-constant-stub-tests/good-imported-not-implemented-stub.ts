// Fixture: an imported handler whose body is not in this file, pinned by a regression
// test that cites its fix from a success-shaped result to an explicit error.
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { groupRuntime } from '../groupManagement';

const run = vi.fn();
const runtime = () => groupRuntime.factory({ agentMember: { run } } as any) as any;

beforeEach(() => run.mockReset());

describe('vote', () => {
  it('returns an explicit not-implemented error (not a success-shaped stub)', async () => {
    const result = await runtime().vote(
      {
        options: [
          { id: 'a', label: 'Option A' },
          { id: 'b', label: 'Option B' },
        ],
        question: 'Which design should we pick?',
      },
      {},
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('VOTE_NOT_IMPLEMENTED');
    expect(result.content).toContain('broadcast');
    expect(run).not.toHaveBeenCalled();
  });
});
