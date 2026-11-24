import { beforeEach, describe, expect, it, vi } from 'vitest';

import { listShareGrantableSkills } from './grantableSkills';

const mocks = vi.hoisted(() => ({
  getAgentVisibility: vi.fn(),
  getUserSettings: vi.fn(),
  listCatalog: vi.fn(),
  userSkillScope: vi.fn(),
}));

vi.mock('@lobechat/builtin-skills', () => ({
  builtinSkills: [{ description: 'LobeHub', identifier: 'lobehub', name: 'LobeHub' }],
}));
// Constructor mocks must be `function`s: `new` on an arrow-function mock throws.
vi.mock('@/database/models/agentSkill', () => ({
  AgentSkillModel: vi.fn(function () {
    return { findAll: async () => ({ data: [] }) };
  }),
}));
vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn(function () {
    return { getAgentVisibility: mocks.getAgentVisibility };
  }),
}));
vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn(function () {
    return { getUserSettings: mocks.getUserSettings };
  }),
}));
vi.mock('@/server/services/agentDocuments', () => ({
  AgentDocumentsService: vi.fn(function () {
    return { getAgentSkills: async () => [] };
  }),
}));
vi.mock('@/server/services/userSkill', () => ({
  UserSkillService: vi.fn(function (...args: unknown[]) {
    mocks.userSkillScope(...args);
    return { listCatalog: mocks.listCatalog };
  }),
}));

const librarySkill = {
  description: 'Summarize weekly notes',
  identifier: 'user-skills:weekly',
  name: 'weekly',
};

describe('listShareGrantableSkills', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listCatalog.mockResolvedValue([librarySkill]);
  });

  it("lists the creator's skill library the Agent opted into, as a run does", async () => {
    const skills = await listShareGrantableSkills({
      agentConfig: { plugins: [{ identifier: librarySkill.identifier, mode: 'auto' }] },
      agentId: 'agent-1',
      db: {} as any,
      userId: 'owner',
    });

    expect(skills.map((skill) => skill.identifier)).toContain(librarySkill.identifier);
    expect(mocks.listCatalog).toHaveBeenCalledWith({ includeGenerated: false });
  });

  it("scopes a workspace Agent's library by the Agent's visibility", async () => {
    mocks.getAgentVisibility.mockResolvedValue('public');

    await listShareGrantableSkills({
      agentConfig: { plugins: [] },
      agentId: 'agent-1',
      db: {} as any,
      userId: 'owner',
      workspaceId: 'ws-1',
    });

    expect(mocks.getAgentVisibility).toHaveBeenCalledWith('agent-1');
    expect(mocks.userSkillScope).toHaveBeenCalledWith({}, 'owner', 'ws-1', 'public');
  });

  describe('legacy builtin skills', () => {
    const legacyAgent = {
      chatConfig: {},
      createdAt: new Date('2026-11-01T00:00:00Z'),
      plugins: [],
    };

    it('offers implicit builtin skills in the share picker', async () => {
      mocks.getUserSettings.mockResolvedValue({});

      const skills = await listShareGrantableSkills({
        agentConfig: legacyAgent,
        agentId: 'agent-1',
        db: {} as any,
        includeLegacyBuiltinSkills: true,
        userId: 'owner',
      });

      expect(skills.map((skill) => skill.identifier)).toContain('lobehub');
    });

    it('keeps implicit builtin skills for an owner with no settings row', async () => {
      mocks.getUserSettings.mockResolvedValue(undefined);

      const skills = await listShareGrantableSkills({
        agentConfig: legacyAgent,
        agentId: 'agent-1',
        db: {} as any,
        includeLegacyBuiltinSkills: true,
        userId: 'owner',
      });

      expect(skills.map((skill) => skill.identifier)).toContain('lobehub');
    });

    it('does not offer legacy builtin skills when the settings read fails', async () => {
      mocks.getUserSettings.mockRejectedValue(new Error('settings unavailable'));

      const skills = await listShareGrantableSkills({
        agentConfig: legacyAgent,
        agentId: 'agent-1',
        db: {} as any,
        includeLegacyBuiltinSkills: true,
        userId: 'owner',
      });

      expect(skills.map((skill) => skill.identifier)).not.toContain('lobehub');
    });

    it('does not auto-grant implicit builtin skills to a visitor run', async () => {
      const skills = await listShareGrantableSkills({
        agentConfig: legacyAgent,
        agentId: 'agent-1',
        db: {} as any,
        userId: 'owner',
      });

      expect(skills.map((skill) => skill.identifier)).not.toContain('lobehub');
      expect(mocks.getUserSettings).not.toHaveBeenCalled();
    });
  });
});
