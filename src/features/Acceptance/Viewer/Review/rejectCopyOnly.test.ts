import { describe, expect, it, vi } from 'vitest';

import { rejectCopyOnly } from './rejectCopyOnly';

describe('rejectCopyOnly', () => {
  it('records the reject without the server send-back', async () => {
    // Regression: a workspace reviewer sees no `origin` (owner-only) and gets
    // the copy path, while the server could still dispatch to the origin agent
    // — the repair would then run twice.
    const reject = vi.fn().mockResolvedValue(undefined);

    await rejectCopyOnly({ acceptanceId: 'acc-1', comment: '补一段录屏', copy: vi.fn(), reject });

    expect(reject).toHaveBeenCalledWith({ comment: '补一段录屏', dispatch: false });
  });

  it('copies the prompt, reason included, before the reject request', async () => {
    const order: string[] = [];
    const copy = vi.fn(async (text: string) => {
      order.push('copy');
      expect(text).toContain('补一段录屏');
      expect(text).toContain('lh acceptance feedback acc-1 --actionable');
    });
    const reject = vi.fn(async () => {
      order.push('reject');
    });

    await rejectCopyOnly({ acceptanceId: 'acc-1', comment: '补一段录屏', copy, reject });

    expect(order).toEqual(['copy', 'reject']);
  });
});
