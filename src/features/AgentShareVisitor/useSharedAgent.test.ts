import { describe, expect, it } from 'vitest';

import { sharedAgentSWRConfig } from './useSharedAgent';

describe('sharedAgentSWRConfig', () => {
  it('does not count browser reconnects as new share visits', () => {
    expect(sharedAgentSWRConfig).toMatchObject({
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    });
  });
});
