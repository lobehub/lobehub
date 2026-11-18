import { beforeEach, describe, expect, it, vi } from 'vitest';

import { agentSkillService } from '@/services/skill';
import { getToolStoreState } from '@/store/tool';

import { resolveClientSkills } from './skillEngineering';

vi.mock('@/store/tool', () => ({
  getToolStoreState: vi.fn(),
}));

vi.mock('@/store/tool/slices/builtin/loadBuiltinSkills', () => ({
  loadBuiltinSkills: async () => getToolStoreState().builtinSkills,
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

/**
 * The skills list and the loaded detail are replica views: the list lives in
 * `agentSkillListMap[AGENT_SKILL_LIST_KEY]` and each detail entry wraps the
 * skill (`{ resourceTree, skillDetail }`).
 */
const setToolState = (state: any) => {
  const { agentSkillDetailMap = {}, agentSkills = [], ...rest } = state;
  mockedGetToolStoreState.mockReturnValue({
    agentSkillDetailMap: Object.fromEntries(
      Object.entries(agentSkillDetailMap).map(([id, skillDetail]) => [
        id,
        { resourceTree: [], skillDetail },
      ]),
    ),
    agentSkillListMap: { all: agentSkills },
    builtinSkills: [],
    ensureAgentSkillsLoaded: vi.fn(),
    ...rest,
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

  it('lists only enabled skills, without loading builtin or DB bodies', async () => {
    setToolState({
      agentSkills: [
        { description: 'd', id: '1', identifier: 'on', name: 'On' },
        { description: 'secret', id: '2', identifier: 'off', name: 'Off' },
      ],
      builtinSkills: [
        { content: 'BODY', description: 'builtin', identifier: 'builtin', name: 'Builtin' },
      ],
    });
    const result = await resolveClientSkills(['builtin', 'on']);
    expect(result.skills).toEqual([
      { description: 'd', identifier: 'on', name: 'On' },
      { description: 'builtin', identifier: 'builtin', name: 'Builtin' },
    ]);
    expect(mockedGetById).not.toHaveBeenCalled();
    expect((await resolveClientSkills([])).skills).toEqual([]);
  });

  describe('agent skill list loading', () => {
    const dbSkill = { description: 'Bound', id: 'db-1', identifier: 'bound-skill', name: 'Bound' };

    it('loads the skill list before assembling the pool, so a send right after a page load sees DB skills', async () => {
      const state: any = { agentSkillListMap: {}, agentSkillDetailMap: {}, builtinSkills: [] };
      state.ensureAgentSkillsLoaded = vi.fn(async () => {
        state.agentSkillListMap = { all: [dbSkill] };
      });
      mockedGetToolStoreState.mockReturnValue(state);

      const result = await resolveClientSkills(['bound-skill']);

      expect(state.ensureAgentSkillsLoaded).toHaveBeenCalledTimes(1);
      expect(findSkill(result.skills, 'bound-skill')).toMatchObject({ name: 'Bound' });
    });

    it('still assembles the pool when the skill list fails to load', async () => {
      setToolState({
        builtinSkills: [
          { content: 'guide', description: 'd', identifier: 'artifacts', name: 'Artifacts' },
        ],
        ensureAgentSkillsLoaded: vi.fn().mockRejectedValue(new Error('network down')),
      });

      const result = await resolveClientSkills(['artifacts']);

      expect(findSkill(result.skills, 'artifacts')).toBeDefined();
    });
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

      const result = await resolveClientSkills(
        ['enabled-skill', 'disabled-skill'],
        ['disabled-skill'],
      );

      expect(findSkill(result.skills, 'disabled-skill')).toBeUndefined();
      expect(findSkill(result.skills, 'enabled-skill')).toBeDefined();
    });
  });
});
