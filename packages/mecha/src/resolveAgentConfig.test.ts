import { describe, expect, it } from 'vitest';

import type { AgentConfigSnapshot } from './resolveAgentConfig';
import { resolveAgentConfig } from './resolveAgentConfig';

/**
 * These rules used to read the browser's Zustand stores directly, which is why
 * the server re-implemented them against its own models. The point of the
 * extraction is that they now run anywhere — so this suite builds the snapshot
 * by hand and never mocks a store. If a store read creeps back in, these fail
 * where the client-side suite would still pass.
 */
const snapshot = (overrides: Partial<AgentConfigSnapshot> = {}): AgentConfigSnapshot => ({
  agentConfig: { model: 'gpt-5', provider: 'openai', systemRole: 'You are helpful.' } as never,
  canManage: true,
  chatConfig: {} as never,
  ...overrides,
});

describe('resolveAgentConfig without a host', () => {
  it('resolves a regular agent from a hand-built snapshot', () => {
    const resolved = resolveAgentConfig({ agentId: 'agt_1' }, snapshot());

    expect(resolved.isBuiltinAgent).toBe(false);
    expect(resolved.agentConfig.systemRole).toContain('You are helpful.');
    expect(resolved.chatConfig).toBeDefined();
  });

  it('appends the reply-language instruction from the snapshot', () => {
    const resolved = resolveAgentConfig({ agentId: 'agt_1' }, snapshot({ userLocale: 'zh-CN' }));

    expect(resolved.agentConfig.systemRole).toContain('zh-CN');
  });

  it('leaves the system role alone when no locale is supplied', () => {
    const resolved = resolveAgentConfig({ agentId: 'agt_1' }, snapshot());

    expect(resolved.agentConfig.systemRole).toBe('You are helpful.');
  });

  it('returns no plugins when the caller disables tools', () => {
    const resolved = resolveAgentConfig(
      { agentId: 'agt_1', disableTools: true },
      snapshot({ agentConfig: { plugins: ['lobe-web-browsing'] } as never }),
    );

    expect(resolved.plugins).toEqual([]);
  });

  it('carries the agent config plugins through for a regular agent', () => {
    const resolved = resolveAgentConfig(
      { agentId: 'agt_1' },
      snapshot({ agentConfig: { plugins: ['lobe-web-browsing'] } as never }),
    );

    expect(resolved.plugins).toContain('lobe-web-browsing');
  });

  it('prefers the caller plugins over the stored ones', () => {
    const resolved = resolveAgentConfig(
      { agentId: 'agt_1', plugins: ['lobe-local-system'] },
      snapshot({ agentConfig: { plugins: ['lobe-web-browsing'] } as never }),
    );

    expect(resolved.plugins).toEqual(['lobe-local-system']);
  });

  it('applies a workspace member mode override onto the chat config', () => {
    const resolved = resolveAgentConfig(
      { agentId: 'agt_1' },
      snapshot({
        agent: { visibility: 'public', workspaceId: 'ws_1' },
        canManage: false,
        memberModeOverride: false,
      }),
    );

    // The override only applies to a public workspace agent the caller cannot
    // manage — the shape the server has to reproduce for a gateway run.
    expect(resolved.chatConfig.enableAgentMode).toBe(false);
  });

  it('lets a collaborative builtin member keep their own model, even as a manager', () => {
    const resolved = resolveAgentConfig(
      { agentId: 'agt_1' },
      snapshot({
        // A collaborative builtin needs all three of these to be recognised.
        agent: { slug: 'inbox', virtual: true, visibility: 'public', workspaceId: 'ws_1' },
        canManage: true,
        memberModelOverride: { model: 'my-own-pick', provider: 'openai' },
      }),
    );

    // These rows have no shared default to manage, so an admin reads their own
    // choice like anyone else. A host that cannot express `slug` and `virtual`
    // in the snapshot would classify this as an ordinary agent and hand the
    // member the workspace-shared model instead — invisible from the browser,
    // which happens to pass a richer object.
    expect(resolved.agentConfig.model).toBe('my-own-pick');
  });

  it('keeps the shared model for an ordinary workspace agent a manager owns', () => {
    const resolved = resolveAgentConfig(
      { agentId: 'agt_1' },
      snapshot({
        // Same row minus the collaborative discriminators.
        agent: { visibility: 'public', workspaceId: 'ws_1' },
        canManage: true,
        memberModelOverride: { model: 'my-own-pick', provider: 'openai' },
      }),
    );

    expect(resolved.agentConfig.model).toBe('gpt-5');
  });

  it('treats a legacy row holding a reserved slug as an ordinary agent', () => {
    const resolved = resolveAgentConfig(
      { agentId: 'agt_1' },
      snapshot({
        // `virtual` is what provisioning writes; a slug alone is not enough.
        agent: { slug: 'inbox', visibility: 'public', workspaceId: 'ws_1' },
        canManage: true,
        memberModelOverride: { model: 'my-own-pick', provider: 'openai' },
      }),
    );

    expect(resolved.agentConfig.model).toBe('gpt-5');
  });

  it('ignores a member mode override when the caller can manage the agent', () => {
    const resolved = resolveAgentConfig(
      { agentId: 'agt_1' },
      snapshot({
        agent: { visibility: 'public', workspaceId: 'ws_1' },
        canManage: true,
        memberModeOverride: false,
      }),
    );

    // A manager reads the shared row, so their own member pick stays dormant.
    expect(resolved.chatConfig.enableAgentMode).toBeUndefined();
  });

  it('lets a per-call model override outrank the member pick and the shared default', () => {
    const resolved = resolveAgentConfig(
      { agentId: 'agt_1', modelOverride: { model: 'pinned-model' } },
      snapshot({
        agent: { visibility: 'public', workspaceId: 'ws_1' },
        canManage: false,
        memberModelOverride: { model: 'member-model', provider: 'anthropic' },
      }),
    );

    // Model is pinned by the call; provider still comes from the member pick.
    expect(resolved.agentConfig.model).toBe('pinned-model');
    expect(resolved.agentConfig.provider).toBe('anthropic');
  });

  it('keeps a user-customized system role on a builtin row over the runtime one', () => {
    const customized = resolveAgentConfig(
      { agentId: 'agt_inbox' },
      snapshot({
        agentConfig: { model: 'gpt-5', provider: 'openai', systemRole: 'Mine.' } as never,
        slug: 'inbox',
      }),
    );
    expect(customized.isBuiltinAgent).toBe(true);
    expect(customized.agentConfig.systemRole).toBe('Mine.');

    const empty = resolveAgentConfig(
      { agentId: 'agt_inbox' },
      snapshot({
        agentConfig: { model: 'gpt-5', provider: 'openai', systemRole: '' } as never,
        slug: 'inbox',
      }),
    );
    // The row has no system role, so the runtime one fills it in.
    expect(empty.agentConfig.systemRole).toBeTruthy();
    expect(empty.agentConfig.systemRole).not.toBe('');
  });
});
