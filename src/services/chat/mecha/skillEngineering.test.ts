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

const findSkill = (skills: { identifier: string }[], identifier: string) =>
  skills.find((s) => s.identifier === identifier);

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
    expect(findSkill(result.skills, 'artifacts')).toMatchObject({
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
    expect(findSkill(result.skills, 'my-skill')?.content).toBeUndefined();
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
    expect(findSkill(result.skills, 'my-skill')?.content).toBe('cached body');
  });

  it('degrades gracefully when a pinned DB skill content fetch fails', async () => {
    setToolState({
      agentSkills: [{ description: '', id: 'db-1', identifier: 'my-skill', name: 'My Skill' }],
    });
    mockedGetById.mockRejectedValue(new Error('network down'));

    const result = await resolveClientSkills(['my-skill']);

    // No throw; skill still listed, just without injected content.
    expect(findSkill(result.skills, 'my-skill')).toMatchObject({ identifier: 'my-skill' });
    expect(findSkill(result.skills, 'my-skill')?.content).toBeUndefined();
  });
});
