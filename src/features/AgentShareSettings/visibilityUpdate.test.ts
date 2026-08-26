import { describe, expect, it, vi } from 'vitest';

import { commitAgentShareVisibility, copyAgentShareLink } from './visibilityUpdate';

describe('copyAgentShareLink', () => {
  it('reports clipboard failures without rejecting the click handler', async () => {
    await expect(
      copyAgentShareLink(vi.fn().mockRejectedValue(new Error('clipboard denied'))),
    ).resolves.toBe(false);
  });
});

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
