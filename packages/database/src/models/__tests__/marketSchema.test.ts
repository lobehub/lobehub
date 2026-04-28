import { describe, expect, it } from 'vitest';

import {
  marketAccounts,
  marketAgentEvents,
  marketAgents,
  marketAgentVersions,
} from '../../schemas';

describe('market schema exports', () => {
  it('exports account and agent tables', () => {
    expect(marketAccounts).toBeDefined();
    expect(marketAgents).toBeDefined();
    expect(marketAgentVersions).toBeDefined();
    expect(marketAgentEvents).toBeDefined();
  });
});
