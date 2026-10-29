// @vitest-environment node
import { HETEROGENEOUS_AGENT_INTERVENTION_PROVIDERS } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { INTERVENTION_PROVIDERS } from './intervention';

describe('INTERVENTION_PROVIDERS', () => {
  it('rehydrates the provider of every agent that can raise an intervention', () => {
    // A provider missing here is dropped when a cold replica reloads a pending
    // card, so its review can no longer be routed back to the right agent.
    expect([...INTERVENTION_PROVIDERS].sort()).toEqual(
      [...HETEROGENEOUS_AGENT_INTERVENTION_PROVIDERS].sort(),
    );
  });
});
