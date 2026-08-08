import { beforeEach, describe, expect, it, vi } from 'vitest';

import { agentSkillService } from '@/services/skill';
import { getToolStoreState } from '@/store/tool';

import { resolveClientSkills } from './skillEngineering';

vi.mock('@/store/tool', () => ({
  getToolStoreState: vi.fn(),
}));

vi.mock('@/services/skill', () => ({
  agentSkillService: {
    getById: vi.fn(),
  },
}));

// Keep all skills available in the test environment.
vi.mock('@/helpers/toolAvailability', () => ({
  isBuiltinSkillAvailableInCurrentEnv: () => true,
}));

const mockedGetToolStoreState = vi.mocked(getToolStoreState);
const mockedGetById = vi.mocked(agentSkillService.getById);

const setToolState = (state: any) => {
  mockedGetToolStoreState.mockReturnValue({
    agentSkillDetailMap: {},
    agentSkills: [],
    builtinSkills: [],
    ...state,
  } as any);
};

const findSkill = (
  skills: { activated?: boolean; content?: string; identifier: string }[],
  identifier: string,
) => skills.find((s) => s.identifier === identifier);

describe('resolveClientSkills', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('carries builtin skill content so pinned builtin skills can be injected', async () => {
    setToolState({
      builtinSkills: [
        {
          content: '<artifacts_guide>build UI</artifacts_guide>',
          description: 'Generate interactive UI',
          identifier: 'artifacts',
          name: 'Artifacts',
          source: 'builtin',
        },
      ],
    });

    const result = await resolveClientSkills(['artifacts']);

    expect(result.enabledPluginIds).toEqual(['artifacts']);
    // activated must be set so SkillContextProvider injects content directly
    // (the MessagesEngine path consumes these metas without running SkillResolver).
    expect(findSkill(result.skills, 'artifacts')).toMatchObject({
      activated: true,
      content: '<artifacts_guide>build UI</artifacts_guide>',
      identifier: 'artifacts',
    });
  });

  it('fetches DB skill content for pinned skills', async () => {
    setToolState({
      agentSkills: [
        { description: 'A user skill', id: 'db-1', identifier: 'my-skill', name: 'My Skill' },
      ],
    });
    mockedGetById.mockResolvedValue({
      content: 'full skill body',
      id: 'db-1',
      identifier: 'my-skill',
      name: 'My Skill',
    } as any);

    const result = await resolveClientSkills(['my-skill']);

    expect(mockedGetById).toHaveBeenCalledWith('db-1');
    expect(findSkill(result.skills, 'my-skill')).toMatchObject({
      activated: true,
      content: 'full skill body',
      identifier: 'my-skill',
    });
  });

  it('appends the resource tree to pinned DB skill content', async () => {
    setToolState({
      agentSkills: [{ description: '', id: 'db-1', identifier: 'my-skill', name: 'My Skill' }],
    });
    mockedGetById.mockResolvedValue({
      content: 'body',
      id: 'db-1',
      identifier: 'my-skill',
      name: 'My Skill',
      resources: { 'kb/readme.md': { fileHash: 'h', size: 1 } },
    } as any);

    const result = await resolveClientSkills(['my-skill']);

    const skill = findSkill(result.skills, 'my-skill');
    expect(skill?.content).toContain('body');
    // resourcesTreePrompt output references the resource tree
    expect(skill?.content).toContain('Available Resources');
    expect(skill?.content).toContain('readme.md');
  });

  it('does NOT fetch content for non-pinned DB skills (auto mode bulk exposure)', async () => {
    setToolState({
      agentSkills: [
        { description: 'A user skill', id: 'db-1', identifier: 'my-skill', name: 'My Skill' },
      ],
    });

    // pluginIds empty => skill is exposed (available list) but not pinned
    const result = await resolveClientSkills([]);

    expect(mockedGetById).not.toHaveBeenCalled();
    const skill = findSkill(result.skills, 'my-skill');
    expect(skill?.content).toBeUndefined();
    expect(skill?.activated).toBeFalsy();
  });

  it('does NOT pre-activate a pinned DB skill bundled as a ZIP', async () => {
    // Bundled skills must go through activateSkill so the server mounts the bundle;
    // pre-injecting content here would reference scripts/resources that are not mounted.
    setToolState({
      agentSkills: [
        {
          description: 'bundled',
          id: 'db-1',
          identifier: 'zip-skill',
          name: 'Zip Skill',
          zipFileHash: 'hash-abc',
        },
      ],
    });

    const result = await resolveClientSkills(['zip-skill']);

    expect(mockedGetById).not.toHaveBeenCalled();
    const skill = findSkill(result.skills, 'zip-skill');
    expect(skill?.content).toBeUndefined();
    expect(skill?.activated).toBeFalsy();
  });

  it('prefers the cached skill detail over a network fetch', async () => {
    setToolState({
      agentSkillDetailMap: {
        'db-1': { content: 'cached body', id: 'db-1', identifier: 'my-skill', name: 'My Skill' },
      },
      agentSkills: [{ description: '', id: 'db-1', identifier: 'my-skill', name: 'My Skill' }],
    });

    const result = await resolveClientSkills(['my-skill']);

    expect(mockedGetById).not.toHaveBeenCalled();
    expect(findSkill(result.skills, 'my-skill')).toMatchObject({
      activated: true,
      content: 'cached body',
    });
  });

  it('degrades gracefully when a pinned DB skill content fetch fails', async () => {
    setToolState({
      agentSkills: [{ description: '', id: 'db-1', identifier: 'my-skill', name: 'My Skill' }],
    });
    mockedGetById.mockRejectedValue(new Error('network down'));

    const result = await resolveClientSkills(['my-skill']);

    // No throw; skill still listed (available, not activated), just without content.
    const skill = findSkill(result.skills, 'my-skill');
    expect(skill).toMatchObject({ identifier: 'my-skill' });
    expect(skill?.content).toBeUndefined();
    expect(skill?.activated).toBeFalsy();
  });

  describe('disabled skills', () => {
    it('excludes a disabled DB skill entirely, not just from the pinned set', async () => {
      setToolState({
        agentSkills: [
          { description: 'A user skill', id: 'db-1', identifier: 'my-skill', name: 'My Skill' },
        ],
      });

      const result = await resolveClientSkills([], ['my-skill']);

      // Not merely unpinned — absent from the candidate pool entirely, so it
      // can't be listed in <available_skills> or resolved by activateSkill.
      expect(findSkill(result.skills, 'my-skill')).toBeUndefined();
    });

    it('excludes a disabled builtin skill entirely', async () => {
      setToolState({
        builtinSkills: [
          {
            content: '<artifacts_guide>build UI</artifacts_guide>',
            description: 'Generate interactive UI',
            identifier: 'artifacts',
            name: 'Artifacts',
            source: 'builtin',
          },
        ],
      });

      const result = await resolveClientSkills([], ['artifacts']);

      expect(findSkill(result.skills, 'artifacts')).toBeUndefined();
    });

    it('keeps a non-disabled skill even when other skills are disabled', async () => {
      setToolState({
        agentSkills: [
          { description: '', id: 'db-1', identifier: 'disabled-skill', name: 'Disabled' },
          { description: '', id: 'db-2', identifier: 'enabled-skill', name: 'Enabled' },
        ],
      });

      const result = await resolveClientSkills([], ['disabled-skill']);

      expect(findSkill(result.skills, 'disabled-skill')).toBeUndefined();
      expect(findSkill(result.skills, 'enabled-skill')).toBeDefined();
    });
  });
});
