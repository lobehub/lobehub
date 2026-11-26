import { AgentAccountIdentifier } from '@lobechat/builtin-tool-agent-account';
import { alwaysOnToolIds } from '@lobechat/builtin-tools';
import { describe, expect, it } from 'vitest';

import { resolveToolRules } from './resolveToolRules';
import type { ToolRuleRequest } from './types';

const request = (overrides: Partial<ToolRuleRequest> = {}): ToolRuleRequest => ({
  agent: { chatConfig: {}, plugins: ['my-plugin'] },
  executionTarget: 'sandbox',
  localExecutionReady: false,
  model: { canUseFC: true },
  ...overrides,
});

describe('resolveToolRules — agent-account gating', () => {
  it('never treats the account tool as an always-on slot', () => {
    expect(alwaysOnToolIds).not.toContain(AgentAccountIdentifier);
  });

  it('leaves the tool out of the candidate pool and disabled when the agent owns nothing', () => {
    const resolved = resolveToolRules(request());

    expect(resolved.rules[AgentAccountIdentifier]).toBe(false);
    expect(resolved.defaultToolIds).not.toContain(AgentAccountIdentifier);
  });

  it('enables and pools the tool once the agent owns an account', () => {
    const resolved = resolveToolRules(request({ hasIdentityAccount: true }));

    expect(resolved.rules[AgentAccountIdentifier]).toBe(true);
    expect(resolved.defaultToolIds).toContain(AgentAccountIdentifier);
  });

  it('defaults the fact to absent, so a host that cannot answer pays nothing', () => {
    // Chat mode drops always-on + identity rules entirely; the tool must not
    // sneak in through the candidate pool there either.
    const chatMode = resolveToolRules(
      request({
        agent: { chatConfig: { enableAgentMode: false }, plugins: [] },
        hasIdentityAccount: true,
      }),
    );

    expect(chatMode.defaultToolIds).not.toContain(AgentAccountIdentifier);
  });
});
