import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentShareConfig } from '@/database/schemas';

import { applyShareAutoAgentGrants, resolveShareAutoAgentGrants } from './autoGrants';
import type { AgentShareGate } from './types';

const listShareGrantableSkills = vi.hoisted(() => vi.fn());
vi.mock('@/server/services/agentShare/grantableSkills', () => ({ listShareGrantableSkills }));
const listShareActivatableExtensionIds = vi.hoisted(() => vi.fn());
vi.mock('@/server/services/agentShare/activatableExtensions', () => ({
  listShareActivatableExtensionIds,
}));

const agent = {
  chatConfig: { memory: { enabled: true } },
  plugins: ['mcp-pinned', 'skill-a'],
  skillIds: ['skill-a', 'skill-b'],
};

describe('applyShareAutoAgentGrants', () => {
  it('leaves the grants untouched while the switch is off', () => {
    const shareConfig: AgentShareConfig = { toolGrants: [{ identifier: 'mcp-pinned' }] };

    expect(applyShareAutoAgentGrants(shareConfig, agent)).toBe(shareConfig);
  });

  it('grants every tool and skill the Agent turns on', () => {
    const { skillGrants, toolGrants } = applyShareAutoAgentGrants(
      { autoGrantAgentTools: true },
      agent,
    );

    expect(toolGrants).toEqual(
      expect.arrayContaining([{ identifier: 'mcp-pinned' }, { identifier: 'lobe-calculator' }]),
    );
    expect(toolGrants?.map((grant) => grant.identifier)).not.toContain('skill-a');
    expect(skillGrants).toEqual(['skill-a', 'skill-b']);
  });

  it('keeps declined identifiers closed', () => {
    const { skillGrants, toolGrants } = applyShareAutoAgentGrants(
      { autoGrantAgentTools: true, declinedGrantIds: ['mcp-pinned', 'skill-b'] },
      agent,
    );

    expect(toolGrants?.map((grant) => grant.identifier)).not.toContain('mcp-pinned');
    expect(skillGrants).toEqual(['skill-a']);
  });

  it('never widens an explicit grant narrowed to some APIs', () => {
    const { toolGrants } = applyShareAutoAgentGrants(
      {
        autoGrantAgentTools: true,
        toolGrants: [{ apis: ['search'], identifier: 'lobe-web-browsing' }],
      },
      agent,
    );

    expect(toolGrants?.filter((grant) => grant.identifier === 'lobe-web-browsing')).toEqual([
      { apis: ['search'], identifier: 'lobe-web-browsing' },
    ]);
  });

  it('drops a tool once the Agent turns it off', () => {
    const { toolGrants } = applyShareAutoAgentGrants(
      { autoGrantAgentTools: true },
      { ...agent, plugins: [{ identifier: 'mcp-pinned', mode: 'disabled' }] },
    );

    expect(toolGrants?.map((grant) => grant.identifier)).not.toContain('mcp-pinned');
  });
});

describe('resolveShareAutoAgentGrants', () => {
  const gate = (shareConfig: AgentShareConfig): AgentShareGate => ({
    agentId: 'agent-1',
    canUseDevice: false,
    shareConfig,
    shareId: 'share-1',
    visitorUserId: 'visitor-1',
  });

  /** The run's Agent after config resolution: `plugins` collapsed to pinned ids. */
  const runAgent = {
    autoSkillIds: [],
    chatConfig: { memory: { enabled: true } },
    disabledPluginIds: [],
    plugins: ['mcp-pinned'],
  };

  beforeEach(() => {
    listShareGrantableSkills.mockReset();
    listShareGrantableSkills.mockResolvedValue([]);
    listShareActivatableExtensionIds.mockReset();
    listShareActivatableExtensionIds.mockResolvedValue([]);
  });

  it('opens a connected connector the Agent has no entry for, unless it is turned off', async () => {
    listShareActivatableExtensionIds.mockResolvedValue(['mcp-connected', 'mcp-off']);
    const listLobehubSkillProviderIds = vi.fn();

    const resolved = await resolveShareAutoAgentGrants(gate({ autoGrantAgentTools: true }), {
      agent: { ...runAgent, disabledPluginIds: ['mcp-off'] },
      db: {} as any,
      listLobehubSkillProviderIds,
      userId: 'owner',
    });

    const toolIds = resolved.shareConfig.toolGrants?.map((grant) => grant.identifier);
    expect(toolIds).toContain('mcp-connected');
    expect(toolIds).not.toContain('mcp-off');
    expect(listShareActivatableExtensionIds).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'agent-1', listLobehubSkillProviderIds }),
    );
  });

  it('reads no skills while the switch is off', async () => {
    const off = gate({ toolGrants: [] });

    await expect(
      resolveShareAutoAgentGrants(off, { agent: runAgent, db: {} as any, userId: 'owner' }),
    ).resolves.toBe(off);
    expect(listShareGrantableSkills).not.toHaveBeenCalled();
    expect(listShareActivatableExtensionIds).not.toHaveBeenCalled();
  });

  it("opens the Agent's grantable skills for the creator's scope", async () => {
    listShareGrantableSkills.mockResolvedValue([
      { description: '', identifier: 'skill-b', name: 'B' },
    ]);

    const resolved = await resolveShareAutoAgentGrants(gate({ autoGrantAgentTools: true }), {
      agent: runAgent,
      db: {} as any,
      userId: 'owner',
      workspaceId: 'ws-1',
    });

    expect(listShareGrantableSkills).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent-1',
        canExecuteOnDevice: false,
        userId: 'owner',
        workspaceId: 'ws-1',
      }),
    );
    expect(resolved.shareConfig.skillGrants).toEqual(['skill-b']);
    expect(resolved.shareId).toBe('share-1');
  });

  it("resolves the skill pool with the visitor's device access", async () => {
    await resolveShareAutoAgentGrants(
      { ...gate({ autoGrantAgentTools: true }), canUseDevice: true },
      { agent: runAgent, db: {} as any, userId: 'owner' },
    );

    expect(listShareGrantableSkills).toHaveBeenCalledWith(
      expect.objectContaining({ canExecuteOnDevice: true }),
    );
  });

  it('honors the auto and disabled entries the pinned-id collapse dropped', async () => {
    const resolved = await resolveShareAutoAgentGrants(gate({ autoGrantAgentTools: true }), {
      agent: {
        ...runAgent,
        autoSkillIds: ['mcp-auto', 'skill-auto'],
        disabledPluginIds: ['lobe-calculator', 'skill-off'],
      },
      db: {} as any,
      userId: 'owner',
    });

    const toolIds = resolved.shareConfig.toolGrants?.map((grant) => grant.identifier);
    expect(toolIds).toContain('mcp-auto');
    expect(toolIds).not.toContain('lobe-calculator');
    expect(listShareGrantableSkills.mock.calls[0][0].agentConfig.plugins).toEqual(
      expect.arrayContaining([
        { identifier: 'skill-auto', mode: 'auto' },
        { identifier: 'skill-off', mode: 'disabled' },
      ]),
    );
  });
});
