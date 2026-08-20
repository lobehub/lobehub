import { describe, expect, it, vi } from 'vitest';

import { navigateFromShareToAgent } from './navigation';

describe('navigateFromShareToAgent', () => {
  it('exits the Share router with a hard history replacement', () => {
    const replace = vi.fn();

    navigateFromShareToAgent('agent-1', { replace });

    expect(replace).toHaveBeenCalledWith('/agent/agent-1');
  });
});
