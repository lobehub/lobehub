import { describe, expect, it } from 'vitest';

import { ClarificationAnswerDeclined, submitClarification } from './submit';

describe('submitClarification', () => {
  it('resolves when the host sends the answers', async () => {
    await expect(submitClarification(async () => {}, [])).resolves.toBeUndefined();
    await expect(submitClarification(() => true, [])).resolves.toBeUndefined();
  });

  // A gate that needs a written correction refuses an empty one with a toast;
  // the form must leave its submitting state instead of spinning forever.
  it('throws a decline when the host refuses the answers', async () => {
    await expect(submitClarification(async () => false, [])).rejects.toBeInstanceOf(
      ClarificationAnswerDeclined,
    );
  });

  it('passes a failed send through unchanged', async () => {
    const error = new Error('network');
    await expect(
      submitClarification(async () => {
        throw error;
      }, []),
    ).rejects.toBe(error);
  });
});
