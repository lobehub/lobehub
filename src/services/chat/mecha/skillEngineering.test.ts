import { beforeEach, describe, expect, it, vi } from 'vitest';

import { agentSkillService } from '@/services/skill';
import { getToolStoreState } from '@/store/tool';
import { confirmedUninstalledBuiltinTools } from '@/store/tool/slices/builtin/projection';

import { resolveClientRunHasSkills, resolveClientSkills } from './skillEngineering';

vi.mock('@/store/agent', () => ({ getAgentStoreState: () => ({}) }));

vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: { getAgentById: () => () => undefined },
}));

vi.mock('@/store/tool/slices/builtin/projection', () => ({
  confirmedUninstalledBuiltinTools: vi.fn(),
  installedImplicitBuiltinSkillIds: () => [],
  legacyDisabledBuiltinSkillsForRun: () => [],
}));

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

  it.each(['legacy pin', 'auto'])(
    'lists an enabled %s without loading either body',
    async (mode) => {
      setToolState({
        agentSkills: [
          { description: 'installed', id: 'db-1', identifier: 'my-skill', name: 'Mine' },
        ],
        builtinSkills: [
          { content: 'guide', description: 'builtin', identifier: 'artifacts', name: 'Artifacts' },
        ],
      });
      const ids = ['my-skill', 'artifacts'];
      const result = await resolveClientSkills(
        mode === 'legacy pin' ? ids : [],
        [],
        'auto',
        [],
        mode === 'auto' ? ids : [],
      );
      expect(result.skills.map((s) => [s.name, s.description])).toEqual([
        ['Mine', 'installed'],
        ['Artifacts', 'builtin'],
      ]);
      expect(result.skills.every((s) => !s.content && !s.activated)).toBe(true);
      expect(mockedGetById).not.toHaveBeenCalled();
    },
  );

  it('does NOT fetch content for non-pinned DB skills (auto mode bulk exposure)', async () => {
    setToolState({
      agentSkills: [
        { description: 'A user skill', id: 'db-1', identifier: 'my-skill', name: 'My Skill' },
      ],
    });

    // set to auto, not pinned => skill is exposed (available list) without its body
    const result = await resolveClientSkills([], undefined, 'auto', undefined, ['my-skill']);

    expect(mockedGetById).not.toHaveBeenCalled();
    const skill = findSkill(result.skills, 'my-skill');
    expect(skill).toBeDefined();
    expect(skill?.content).toBeUndefined();
    expect(skill?.activated).toBeFalsy();
  });

  it('leaves out a library skill the agent never turned on, including builtin skills', async () => {
    setToolState({
      agentSkills: [
        { description: 'A user skill', id: 'db-1', identifier: 'my-skill', name: 'My Skill' },
      ],
      builtinSkills: [
        { content: 'guide', description: 'd', identifier: 'artifacts', name: 'Artifacts' },
      ],
    });

    const result = await resolveClientSkills([]);

    expect(findSkill(result.skills, 'my-skill')).toBeUndefined();
    expect(findSkill(result.skills, 'artifacts')).toBeUndefined();
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

  it('keeps a turn skill selectable in manual mode without pinning it', async () => {
    setToolState({
      builtinSkills: [
        {
          content: '<lh_guide />',
          description: 'LobeHub CLI',
          identifier: 'lobehub',
          name: 'lobehub',
        },
      ],
    });

    const result = await resolveClientSkills([], [], 'manual', ['lobehub']);

    expect(result.enabledPluginIds).toEqual([]);
    expect(findSkill(result.skills, 'lobehub')).toMatchObject({ name: 'lobehub' });
  });

  describe('agent skill list loading', () => {
    const dbSkill = { description: 'Bound', id: 'db-1', identifier: 'bound-skill', name: 'Bound' };

    it('loads the skill list before assembling the pool, so a send right after a page load sees DB skills', async () => {
      const state: any = { agentSkillListMap: {}, agentSkillDetailMap: {}, builtinSkills: [] };
      state.ensureAgentSkillsLoaded = vi.fn(async () => {
        state.agentSkillListMap = { all: [dbSkill] };
      });
      mockedGetToolStoreState.mockReturnValue(state);

      const result = await resolveClientSkills([], undefined, 'auto', undefined, ['bound-skill']);

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

      const result = await resolveClientSkills([], ['disabled-skill'], 'auto', undefined, [
        'enabled-skill',
      ]);

      expect(findSkill(result.skills, 'disabled-skill')).toBeUndefined();
      expect(findSkill(result.skills, 'enabled-skill')).toBeDefined();
    });
  });
});

describe('resolveClientRunHasSkills', () => {
  const agentConfig = {
    agentConfig: { plugins: [] },
    chatConfig: {},
    plugins: [],
  } as any;
  const syncedList = { entries: { all: { source: 'server' } } };
  const userMessage = (extra: Record<string, unknown> = {}) =>
    ({ content: 'Hi', id: 'u-1', role: 'user', ...extra }) as any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(confirmedUninstalledBuiltinTools).mockReturnValue([]);
  });

  it('reports no skills once the server confirmed an empty pool', async () => {
    setToolState({ agentSkillListReplica: syncedList });

    await expect(
      resolveClientRunHasSkills({ agentConfig, messages: [userMessage()] }),
    ).resolves.toBe(false);
  });

  it('reports skills when the agent has one enabled', async () => {
    setToolState({
      agentSkillListReplica: syncedList,
      agentSkills: [{ description: 'mine', id: 'db-1', identifier: 'my-skill', name: 'Mine' }],
    });

    await expect(
      resolveClientRunHasSkills({
        agentConfig: { ...agentConfig, plugins: ['my-skill'] },
        messages: [userMessage()],
      }),
    ).resolves.toBe(true);
  });

  // The main send path persists a `/` selection on the user message instead of
  // passing it with the run, and the skill need not be enabled on the agent.
  it('reports skills when a user turn selected one the agent has not enabled', async () => {
    setToolState({ agentSkillListReplica: syncedList });

    await expect(
      resolveClientRunHasSkills({
        agentConfig,
        messages: [userMessage({ metadata: { selectedSkillIds: ['my-skill'] } })],
      }),
    ).resolves.toBe(true);
  });

  it('reads a selection from the editor state of an older user turn', async () => {
    setToolState({ agentSkillListReplica: syncedList });
    const editorData = {
      root: {
        children: [
          {
            children: [
              {
                actionCategory: 'skill',
                actionLabel: 'Mine',
                actionType: 'my-skill',
                type: 'action-tag',
              },
            ],
            type: 'paragraph',
          },
        ],
        type: 'root',
      },
    };

    await expect(
      resolveClientRunHasSkills({
        agentConfig,
        messages: [userMessage({ editorData }), userMessage({ id: 'u-2' })],
      }),
    ).resolves.toBe(true);
  });

  it('cannot tell while the installed skill list is unconfirmed', async () => {
    setToolState({});

    await expect(
      resolveClientRunHasSkills({ agentConfig, messages: [userMessage()] }),
    ).resolves.toBeUndefined();
  });

  it('cannot tell while the builtin uninstall list is unconfirmed', async () => {
    setToolState({ agentSkillListReplica: syncedList });
    vi.mocked(confirmedUninstalledBuiltinTools).mockReturnValue(undefined);

    await expect(
      resolveClientRunHasSkills({ agentConfig, messages: [userMessage()] }),
    ).resolves.toBeUndefined();
  });
});
