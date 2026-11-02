import { toast } from '@lobehub/ui';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { removeNoteWithFeedback } from './removeNoteWithFeedback';

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast: { error: vi.fn() },
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('removeNoteWithFeedback', () => {
  it('runs onRemoved after a successful delete', async () => {
    const onRemoved = vi.fn();
    const removeNote = vi.fn().mockResolvedValue(undefined);

    await expect(
      removeNoteWithFeedback({ failedMessage: 'failed', id: 'n1', onRemoved, removeNote }),
    ).resolves.toBe(true);

    expect(removeNote).toHaveBeenCalledWith('n1');
    expect(onRemoved).toHaveBeenCalledOnce();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('shows the failure toast instead of rejecting when the delete fails', async () => {
    // ROOT CAUSE:
    // The Home feed's delete confirm awaited `removeNote` with no catch, so a failed delete was an
    // unhandled rejection with no feedback to the user.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onRemoved = vi.fn();
    const removeNote = vi.fn().mockRejectedValue(new Error('network'));

    await expect(
      removeNoteWithFeedback({ failedMessage: 'failed', id: 'n1', onRemoved, removeNote }),
    ).resolves.toBe(false);

    expect(toast.error).toHaveBeenCalledWith('failed');
    expect(onRemoved).not.toHaveBeenCalled();
  });
});
