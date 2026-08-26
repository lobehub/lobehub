import { describe, expect, it, vi } from 'vitest';

import { copyCheckRepairPrompt } from './checkWork';

describe('copyCheckRepairPrompt', () => {
  it('copies a check-scoped repair prompt without dispatching work elsewhere', async () => {
    const copy = vi.fn().mockResolvedValue(undefined);

    await copyCheckRepairPrompt(
      'acceptance-1',
      { id: 'check-2', seq: 2, title: 'Header verdict' },
      copy,
    );

    expect(copy).toHaveBeenCalledOnce();
    expect(copy).toHaveBeenCalledWith(expect.stringContaining('focus on check C2'));
    expect(copy).toHaveBeenCalledWith(expect.stringContaining('check id: check-2'));
  });
});
