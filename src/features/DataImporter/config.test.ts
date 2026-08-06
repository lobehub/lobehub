import { describe, expect, it } from 'vitest';

import { parseConfigFile } from './config';

describe('parseConfigFile', () => {
  it('returns parsed data for valid JSON', async () => {
    const file = new File(['{"version":1}'], 'backup.json', { type: 'application/json' });

    await expect(parseConfigFile(file)).resolves.toEqual({
      data: { version: 1 },
      success: true,
    });
  });

  it('returns a validation error instead of showing global feedback', async () => {
    const file = new File(['{"version":'], 'broken.json', { type: 'application/json' });

    const result = await parseConfigFile(file);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
  });
});
