import type * as BusinessConst from '@lobechat/business-const';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Each case re-imports the agent modules from cold after `vi.resetModules()`,
// and that graph reaches the builtin-tool packages. The first one routinely
// exceeds the 5s default while the rest run warm — a timeout here would say
// nothing about the avatars.
vi.setConfig({ testTimeout: 30_000 });

/**
 * Built-in agents must not keep the upstream mascot on a rebranded deployment.
 *
 * These avatars were literal `/avatars/*.png` paths, so they survived a rebrand
 * that had already replaced the inbox agent sitting next to them in the same
 * picker — the mismatch is only visible when the two are listed together, which
 * is exactly where users saw it.
 *
 * Checked from the agent definitions rather than the constants, because the
 * defect was never in the constants: it was three call sites not using them.
 */
const loadAvatars = async (brandingLogoUrl: string) => {
  vi.resetModules();
  vi.doMock('@lobechat/business-const', async (importOriginal) => ({
    ...(await importOriginal<typeof BusinessConst>()),
    BRANDING_LOGO_URL: brandingLogoUrl,
  }));

  const [agentBuilder, groupAgentBuilder, pageAgent, inbox] = await Promise.all([
    import('./agent-builder'),
    import('./group-agent-builder'),
    import('./page-agent'),
    import('./inbox'),
  ]);

  return {
    agentBuilder: agentBuilder.AGENT_BUILDER.avatar,
    groupAgentBuilder: groupAgentBuilder.GROUP_AGENT_BUILDER.avatar,
    inbox: inbox.INBOX.avatar,
    pageAgent: pageAgent.PAGE_AGENT.avatar,
  };
};

afterEach(() => {
  vi.doUnmock('@lobechat/business-const');
  vi.resetModules();
});

describe('built-in agent avatars', () => {
  it('all follow the branded logo when one is configured', async () => {
    const avatars = await loadAvatars('/branding/logo.png');

    // Including the inbox: the point is that they agree, not that three of them
    // changed.
    for (const [agent, avatar] of Object.entries(avatars))
      expect(avatar, agent).toBe('/branding/logo.png');
  });

  it('leaves no upstream mascot behind under custom branding', async () => {
    const avatars = await loadAvatars('/branding/logo.png');

    for (const [agent, avatar] of Object.entries(avatars))
      expect(avatar, agent).not.toMatch(/\/avatars\//);
  });

  // Upstream ships no logo, and each agent's own artwork is worth keeping there.
  it('keeps each agent distinct when no logo is configured', async () => {
    const avatars = await loadAvatars('');

    expect(avatars.agentBuilder).toBe('/avatars/agent-builder.png');
    expect(avatars.groupAgentBuilder).toBe('/avatars/agent-builder.png');
    expect(avatars.pageAgent).toBe('/avatars/doc-copilot.png');
    expect(avatars.inbox).toBe('/avatars/lobe-ai.png');
  });
});
