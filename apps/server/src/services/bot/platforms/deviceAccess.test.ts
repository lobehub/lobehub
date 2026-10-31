import { describe, expect, it } from 'vitest';

import { extractDeviceAllowlist } from './deviceAccess';

describe('extractDeviceAllowlist', () => {
  it('returns the listed IDs under the allowlist policy', () => {
    expect(
      extractDeviceAllowlist({
        deviceAllowFrom: [{ id: ' u1 ', name: 'Ada' }, { id: '' }, { id: 'u2' }],
        devicePolicy: 'allowlist',
      }),
    ).toEqual(['u1', 'u2']);
  });

  it('ignores a kept list while the policy is owner only', () => {
    expect(
      extractDeviceAllowlist({ deviceAllowFrom: [{ id: 'u1' }], devicePolicy: 'owner' }),
    ).toEqual([]);
  });

  it('fails closed for missing or malformed settings', () => {
    expect(extractDeviceAllowlist(undefined)).toEqual([]);
    expect(extractDeviceAllowlist({ deviceAllowFrom: [{ id: 'u1' }] })).toEqual([]);
    expect(extractDeviceAllowlist({ deviceAllowFrom: 'u1', devicePolicy: 'everyone' })).toEqual([]);
  });
});
