import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createLibrarySkillGate, resolveAgentSkillGates } from './librarySkillGate';

const mocks = vi.hoisted(() => ({ getAgentConfigById: vi.fn(), getUserSettings: vi.fn() }));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn(function () {
    return { getAgentConfigById: mocks.getAgentConfigById };
  }),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn(function () {
    return { getUserSettings: mocks.getUserSettings };
  }),
}));

describe('createLibrarySkillGate', () => {
  it('refuses a library skill the agent never turned on', () => {
    const isEnabled = createLibrarySkillGate(['lobe-web-browsing'], []);

    expect(isEnabled('excalidraw')).toBe(false);
  });

  it('opens a library skill the agent pinned or set to auto', () => {
    const isEnabled = createLibrarySkillGate(['pinned', { identifier: 'auto', mode: 'auto' }]);

    expect(isEnabled('pinned')).toBe(true);
    expect(isEnabled('auto')).toBe(true);
  });

  it('refuses a library skill the agent disabled', () => {
    const isEnabled = createLibrarySkillGate([{ identifier: 'off', mode: 'disabled' }]);

    expect(isEnabled('off')).toBe(false);
  });

  it('opens a skill the operation pool already offers, such as one the user selected this turn', () => {
    const isEnabled = createLibrarySkillGate(undefined, ['selected-this-turn']);

    expect(isEnabled('selected-this-turn')).toBe(true);
    expect(isEnabled('something-else')).toBe(false);
  });
});

describe('resolveAgentSkillGates', () => {
  const context = { agentId: 'agent-1', serverDB: {} as never, userId: 'user-1' };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserSettings.mockResolvedValue({});
    mocks.getAgentConfigById.mockResolvedValue({
      plugins: [
        { identifier: 'off', mode: 'disabled' },
        { identifier: 'on', mode: 'auto' },
      ],
    });
  });

  it('derives both gates from the run agent’s own config', async () => {
    const { disabledSkillIds, isLibrarySkillEnabled } = await resolveAgentSkillGates(context);

    expect([...disabledSkillIds]).toEqual(['off']);
    expect(isLibrarySkillEnabled?.('on')).toBe(true);
    expect(isLibrarySkillEnabled?.('never-turned-on')).toBe(false);
  });

  it('lets a skill the operation pool offers through', async () => {
    const { isLibrarySkillEnabled } = await resolveAgentSkillGates({
      ...context,
      runSkillIds: ['selected-this-turn'],
    });

    expect(isLibrarySkillEnabled?.('selected-this-turn')).toBe(true);
  });

  it('leaves a share visitor to the creator’s skill grant instead', async () => {
    const { isLibrarySkillEnabled } = await resolveAgentSkillGates({
      ...context,
      agentShareVisitor: { skillGrants: ['granted'] } as never,
    });

    expect(isLibrarySkillEnabled).toBeUndefined();
  });

  it('honors the workspace uninstall until the running agent explicitly opts in again', async () => {
    const id = 'lobe-artifacts';
    mocks.getUserSettings.mockResolvedValue({
      tool: { uninstalledBuiltinToolsByWorkspace: { ws: [id] } },
    });
    mocks.getAgentConfigById.mockResolvedValue({ plugins: [id], workspaceId: 'ws' });
    expect((await resolveAgentSkillGates(context)).disabledSkillIds.has(id)).toBe(true);
    mocks.getAgentConfigById.mockResolvedValue({
      plugins: [{ builtinOverride: true, identifier: id, mode: 'auto' }],
      workspaceId: 'ws',
    });
    expect((await resolveAgentSkillGates(context)).disabledSkillIds.has(id)).toBe(false);
  });

  it('applies no gate when the run has no agent', async () => {
    const gates = await resolveAgentSkillGates({ serverDB: {} as never, userId: 'user-1' });

    expect(gates.isLibrarySkillEnabled).toBeUndefined();
    expect(gates.disabledSkillIds.size).toBe(0);
    expect(mocks.getAgentConfigById).not.toHaveBeenCalled();
  });
});
