import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveSSRFPolicy } from './policy';

afterEach(() => vi.unstubAllEnvs());

describe('shared SSRF configuration', () => {
  it('parses the operator list once without discarding existing CIDR entries', () => {
    vi.stubEnv('SSRF_ALLOW_IP_ADDRESS_LIST', ' 192.168.1.234, ,10.0.0.0/8 ');
    expect(resolveSSRFPolicy().allowIPAddressList).toEqual(['192.168.1.234', '10.0.0.0/8']);
  });

  it('preserves explicit empty overrides and strict callers', () => {
    vi.stubEnv('SSRF_ALLOW_IP_ADDRESS_LIST', '192.168.1.234');
    vi.stubEnv('SSRF_ALLOW_PRIVATE_IP_ADDRESS', '1');
    expect(resolveSSRFPolicy({ allowIPAddressList: [], allowPrivateIPAddress: false })).toEqual({
      allowIPAddressList: [],
      allowPrivateIPAddress: false,
      allowMetaIPAddress: false,
      denyIPAddressList: [],
    });
    expect(resolveSSRFPolicy().allowPrivateIPAddress).toBe(true);
  });
});
