import { describe, expect, it, vi } from 'vitest';

import { commitAgentShareVisibility } from './visibilityUpdate';

describe('commitAgentShareVisibility', () => {
  it('keeps the committed visibility result when copying the link fails', async () => {
    const updateVisibility = vi.fn().mockResolvedValue(undefined);
    const copyLink = vi.fn().mockRejectedValue(new Error('clipboard denied'));

    await expect(
      commitAgentShareVisibility({ copyLink, shouldCopyLink: true, updateVisibility }),
    ).resolves.toBe('updated-copy-failed');
    expect(updateVisibility).toHaveBeenCalledOnce();
    expect(copyLink).toHaveBeenCalledOnce();
  });

  it('still rejects when the visibility mutation itself fails', async () => {
    const updateVisibility = vi.fn().mockRejectedValue(new Error('network down'));
    const copyLink = vi.fn();

    await expect(
      commitAgentShareVisibility({ copyLink, shouldCopyLink: true, updateVisibility }),
    ).rejects.toThrow('network down');
    expect(copyLink).not.toHaveBeenCalled();
  });
});
