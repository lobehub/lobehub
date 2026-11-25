import { describe, expect, it } from 'vitest';

import { type ToolStoreState } from '../../initialState';
import { initialState } from '../../initialState';
import { builtinToolSelectors } from './selectors';

// Mock builtin skill for testing
const mockBuiltinSkill = {
  avatar: '🧪',
  content: '# Test Skill',
  description: 'A test skill',
  identifier: 'test-skill',
  name: 'Test Skill',
  source: 'builtin' as const,
};

const hiddenToolsState = () => ({
  ...initialState,
  builtinTools: [
    {
      hidden: true,
      identifier: 'lobe-task',
      manifest: {
        api: [],
        identifier: 'lobe-task',
        meta: { title: 'Task Tools' },
        systemRole: '',
      },
      type: 'builtin',
    },
    {
      hidden: true,
      identifier: 'tool-1',
      manifest: { api: [], identifier: 'tool-1', meta: { title: 'Tool 1' }, systemRole: '' },
      type: 'builtin',
    },
  ],
  uninstalledBuiltinTools: [],
});

describe('builtinToolSelectors', () => {
  it('keeps a bundled skill available to the agent picker after a legacy uninstall', () => {
    const state = {
      ...initialState,
      builtinSkills: [mockBuiltinSkill],
      uninstalledBuiltinTools: [mockBuiltinSkill.identifier],
    };
    expect(builtinToolSelectors.installedBuiltinSkills(state)).toEqual([mockBuiltinSkill]);
  });

  it('offers the calculator in agent tools even when legacy settings list it as uninstalled', () => {
    const id = 'lobe-calculator';
    const state = { ...initialState, uninstalledBuiltinTools: [id] };
    expect(
      builtinToolSelectors.metaListIncludingHidden(state).map((item) => item.identifier),
    ).toContain(id);
  });

  describe('metaList', () => {
    it('should return meta list with builtin tools and skills', () => {
      const state = {
        ...initialState,
        builtinSkills: [mockBuiltinSkill],
        builtinTools: [
          {
            identifier: 'tool-1',
            type: 'builtin',
            manifest: { api: [], identifier: 'tool-1', meta: { title: 'Tool 1' }, systemRole: '' },
          },
        ],
        uninstalledBuiltinTools: [],
      } as ToolStoreState;
      const result = builtinToolSelectors.metaList(state);
      expect(result).toEqual([
        {
          author: 'LobeHub',
          identifier: 'test-skill',
          meta: { avatar: '🧪', description: 'A test skill', title: 'Test Skill' },
          type: 'builtin',
        },
        { author: 'LobeHub', identifier: 'tool-1', meta: { title: 'Tool 1' }, type: 'builtin' },
      ]);
    });

    it('should hide tool when not need visible with hidden', () => {
      const state = {
        ...initialState,
        builtinSkills: [mockBuiltinSkill],
        builtinTools: [
          {
            identifier: 'tool-1',
            type: 'builtin',
            hidden: true,
            manifest: { api: [], identifier: 'tool-1', meta: { title: 'Tool 1' }, systemRole: '' },
          },
        ],
      } as ToolStoreState;
      const result = builtinToolSelectors.metaList(state);
      // Should only contain skill, hidden tool is filtered out
      expect(result).toEqual([
        {
          author: 'LobeHub',
          identifier: 'test-skill',
          meta: { avatar: '🧪', description: 'A test skill', title: 'Test Skill' },
          type: 'builtin',
        },
      ]);
    });

    it('should return an empty list if no builtin tools or skills are available', () => {
      const state: ToolStoreState = {
        ...initialState,
        builtinSkills: [],
        builtinTools: [],
      };
      const result = builtinToolSelectors.metaList(state);
      expect(result).toEqual([]);
    });
  });

  describe('metaListIncludingHidden', () => {
    it('should surface hidden tools so users can toggle them', () => {
      const state = hiddenToolsState() as ToolStoreState;

      const result = builtinToolSelectors.metaListIncludingHidden(state);

      expect(result.map((item) => item.identifier)).toContain('tool-1');
      expect(result.map((item) => item.identifier)).toContain('lobe-task');
    });
  });

  it('keeps fixed loaders out of both tool pickers but leaves Skill Store configurable', () => {
    for (const select of [
      builtinToolSelectors.metaList,
      builtinToolSelectors.metaListIncludingHidden,
    ]) {
      const ids = select(initialState).map((tool) => tool.identifier);
      expect(ids).not.toContain('lobe-skills');
      expect(ids).not.toContain('lobe-activator');
      expect(ids).toContain('lobe-skill-store');
    }
  });

  describe('installedAllMetaList', () => {
    it('should include all non-uninstalled tools in agent profile configuration', () => {
      const state = hiddenToolsState() as ToolStoreState;

      const result = builtinToolSelectors.installedAllMetaList(state);

      expect(result.map((item) => item.identifier)).toEqual(['lobe-task', 'tool-1']);
    });
  });

  describe('installedProfileConfigurableMetaList', () => {
    it('should expose only builtin tools whose lifecycle is controlled by Agent Profile', () => {
      const state = {
        ...initialState,
        builtinTools: [
          {
            hidden: true,
            identifier: 'lobe-web-browsing',
            manifest: {
              api: [],
              identifier: 'lobe-web-browsing',
              meta: { title: 'Web Browsing' },
              systemRole: '',
            },
            type: 'builtin',
          },
          {
            discoverable: false,
            hidden: true,
            identifier: 'lobe-verify',
            manifest: {
              api: [],
              identifier: 'lobe-verify',
              meta: { title: 'Verifier' },
              systemRole: '',
            },
            type: 'builtin',
          },
          {
            hidden: true,
            identifier: 'lobe-skill-store',
            manifest: {
              api: [],
              identifier: 'lobe-skill-store',
              meta: { title: 'Skill Store' },
              systemRole: '',
            },
            type: 'builtin',
          },
          {
            hidden: true,
            identifier: 'lobe-agent-management',
            manifest: {
              api: [],
              identifier: 'lobe-agent-management',
              meta: { title: 'Agent Management' },
              systemRole: '',
            },
            type: 'builtin',
          },
          {
            identifier: 'profile-tool',
            manifest: {
              api: [],
              identifier: 'profile-tool',
              meta: { title: 'Profile Tool' },
              systemRole: '',
            },
            type: 'builtin',
          },
          {
            identifier: 'uninstalled-tool',
            manifest: {
              api: [],
              identifier: 'uninstalled-tool',
              meta: { title: 'Uninstalled Tool' },
              systemRole: '',
            },
            type: 'builtin',
          },
        ],
        uninstalledBuiltinTools: ['uninstalled-tool'],
      } as ToolStoreState;

      const visible = builtinToolSelectors.installedProfileConfigurableMetaList(state);
      const excluded = builtinToolSelectors.nonProfileConfigurableBuiltinToolIds(state);

      expect(visible.map((item) => item.identifier)).toEqual([
        'lobe-skill-store',
        'lobe-agent-management',
        'profile-tool',
      ]);
      expect(excluded).toEqual(expect.arrayContaining(['lobe-web-browsing', 'lobe-verify']));
      expect(excluded).not.toContain('lobe-skill-store');
      expect(excluded).not.toContain('lobe-agent-management');
    });
  });

  describe('needsBuiltinOverride', () => {
    it.each([
      ['an on-demand builtin tool', 'lobe-calculator', true],
      ['a legacy builtin skill', 'lobe-artifacts', true],
      ['a connector', 'plugin-1', false],
    ])('classifies %s', (_name, identifier, expected) => {
      expect(builtinToolSelectors.needsBuiltinOverride(identifier)).toBe(expected);
    });
  });
});
