import { describe, expect, it } from 'vitest';

import { normalizeServerHostname } from './normalizeServerHostname.js';

describe('normalizeServerHostname', () => {
  it.each(['container-id', 'pod-name', 'localhost'])(
    'replaces the injected hostname %s with an all-interface bind address',
    (hostname) => {
      const env = { HOSTNAME: hostname };

      normalizeServerHostname(env);

      expect(env.HOSTNAME).toBe('0.0.0.0');
    },
  );

  it.each(['0.0.0.0', '127.0.0.1', '::', '2001:db8::1'])(
    'preserves the explicit IP bind address %s',
    (hostname) => {
      const env = { HOSTNAME: hostname };

      normalizeServerHostname(env);

      expect(env.HOSTNAME).toBe(hostname);
    },
  );

  it('leaves an unset hostname unchanged', () => {
    const env = {};

    normalizeServerHostname(env);

    expect(env).not.toHaveProperty('HOSTNAME');
  });
});
