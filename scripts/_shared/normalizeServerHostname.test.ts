import { describe, expect, it } from 'vitest';

import { normalizeServerHostname } from './normalizeServerHostname.js';

describe('normalizeServerHostname', () => {
  it.each(['container-id', 'pod-name'])(
    'replaces the injected hostname %s with an all-interface bind address',
    (hostname) => {
      const env = { HOSTNAME: hostname };

      normalizeServerHostname(env, hostname);

      expect(env.HOSTNAME).toBe('0.0.0.0');
    },
  );

  it.each(['localhost', 'service.internal', '0.0.0.0', '127.0.0.1', '::', '2001:db8::1'])(
    'preserves the explicit bind hostname %s',
    (hostname) => {
      const env = { HOSTNAME: hostname };

      normalizeServerHostname(env, 'container-id');

      expect(env.HOSTNAME).toBe(hostname);
    },
  );

  it.each(['0.0.0.0', '127.0.0.1', '::', '2001:db8::1'])(
    'preserves the runtime hostname when it is an IP address %s',
    (hostname) => {
      const env = { HOSTNAME: hostname };

      normalizeServerHostname(env, hostname);

      expect(env.HOSTNAME).toBe(hostname);
    },
  );

  it('leaves an unset hostname unchanged', () => {
    const env = {};

    normalizeServerHostname(env, 'container-id');

    expect(env).not.toHaveProperty('HOSTNAME');
  });
});
