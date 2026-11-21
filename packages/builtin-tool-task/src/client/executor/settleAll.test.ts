import { describe, expect, it } from 'vitest';

import { settleAll } from './settleAll';

describe('settleAll', () => {
  it('waits for every operation before rethrowing the first failure', async () => {
    let slowDone = false;
    const slow = new Promise<void>((resolve) =>
      setTimeout(() => {
        slowDone = true;
        resolve();
      }, 20),
    );

    await expect(
      settleAll([Promise.reject(new Error('label write failed')), slow]),
    ).rejects.toThrow('label write failed');
    expect(slowDone).toBe(true);
  });

  it('resolves when every operation succeeds', async () => {
    await expect(settleAll([Promise.resolve(1), Promise.resolve(2)])).resolves.toBeUndefined();
  });
});
