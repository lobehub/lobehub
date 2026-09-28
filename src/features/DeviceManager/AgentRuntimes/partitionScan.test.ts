import { describe, expect, it } from 'vitest';

import { partitionScan } from './partitionScan';

describe('partitionScan', () => {
  const providers = [{ type: 'claude-code' }, { type: 'codex' }, { type: 'kimi-code' }];

  it('keeps display order, carries versions, and skips unprobed types', () => {
    const result = partitionScan(
      {
        'claude-code': { available: true, version: '2.1.0' },
        'codex': { available: false, reason: 'not found' },
      } as any,
      providers,
    );

    expect(result).toEqual({
      installed: [{ provider: { type: 'claude-code' }, version: '2.1.0' }],
      missing: [{ type: 'codex' }],
    });
  });
});
