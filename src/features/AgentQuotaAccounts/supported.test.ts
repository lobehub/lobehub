import { describe, expect, it } from 'vitest';

import { usesAgentQuotaAccounts } from './supported';

describe('usesAgentQuotaAccounts', () => {
  it('treats Claude Code without a stored auth mode as subscription mode', () => {
    expect(usesAgentQuotaAccounts({ type: 'claude-code' } as any)).toBe(true);
    expect(usesAgentQuotaAccounts({ authMode: 'subscription', type: 'claude-code' } as any)).toBe(
      true,
    );
  });

  it('leaves API-key mode, other agents and plain agents out', () => {
    expect(usesAgentQuotaAccounts({ authMode: 'api', type: 'claude-code' } as any)).toBe(false);
    expect(usesAgentQuotaAccounts({ type: 'codex' } as any)).toBe(false);
    expect(usesAgentQuotaAccounts(undefined)).toBe(false);
  });
});
