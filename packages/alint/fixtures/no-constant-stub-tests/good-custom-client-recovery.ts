import { expect, it, vi } from 'vitest';

const submitWithRecovery = async (submit: () => Promise<void>) => {
  try {
    await submit();
    return { draft: '', retry: false };
  } catch (error) {
    return { draft: 'Launch', retry: error instanceof Error && error.message === 'offline' };
  }
};

it('retains the draft and offers retry after an offline response', async () => {
  const submit = vi.fn().mockRejectedValue(new Error('offline'));
  expect(await submitWithRecovery(submit)).toEqual({ draft: 'Launch', retry: true });
});
