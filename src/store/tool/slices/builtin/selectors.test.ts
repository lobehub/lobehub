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

describe('builtinToolSelectors', () => {
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
      const state = {
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
      } as ToolStoreState;

      const result = builtinToolSelectors.metaListIncludingHidden(state);

      expect(result.map((item) => item.identifier)).toContain('tool-1');
      expect(result.map((item) => item.identifier)).toContain('lobe-task');
    });
  });

  describe('fixedDisplayMetaList', () => {
    const fixedState = {
      ...initialState,
      builtinTools: [
        {
          hidden: true,
          identifier: 'lobe-agent',
          manifest: {
            api: [],
            identifier: 'lobe-agent',
            meta: { avatar: '🤖', title: 'Lobe Agent' },
            systemRole: '',
          },
          type: 'builtin',
        },
        {
          discoverable: false,
          hidden: true,
          identifier: 'lobe-activator',
          manifest: { api: [], identifier: 'lobe-activator', meta: {}, systemRole: '' },
          type: 'builtin',
        },
        {
          hidden: true,
          identifier: 'lobe-skill-store',
          manifest: { api: [], identifier: 'lobe-skill-store', meta: {}, systemRole: '' },
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
    } as ToolStoreState;

    it('should surface app-fixed tools (e.g. lobe-agent) even though they are hidden', () => {
      const result = builtinToolSelectors.fixedDisplayMetaList()(fixedState);

      // Only fixed-display ids are returned; lobe-agent leads the list, unrelated tools excluded.
      expect(result.map((item) => item.identifier)).toContain('lobe-agent');
      expect(result.map((item) => item.identifier)).not.toContain('lobe-activator');
      expect(result.map((item) => item.identifier)).not.toContain('tool-1');
      expect(result[0].identifier).toBe('lobe-agent');
    });

    it('should drop manual-mode-excluded discovery tools in manual mode', () => {
      const result = builtinToolSelectors.fixedDisplayMetaList({ isManualMode: true })(fixedState);
      const ids = result.map((item) => item.identifier);

      // activator + skill-store are stripped from defaults in manual mode, so they aren't on.
      expect(ids).not.toContain('lobe-activator');
      expect(ids).not.toContain('lobe-skill-store');
      // lobe-agent stays on in manual mode.
      expect(ids).toContain('lobe-agent');
    });

    it('should skip fixed ids that are not registered in builtinTools', () => {
      const state = {
        ...initialState,
        builtinTools: [],
      } as unknown as ToolStoreState;

      expect(builtinToolSelectors.fixedDisplayMetaList()(state)).toEqual([]);
    });
  });

  describe('installedAllMetaList', () => {
    it('should include all non-uninstalled tools in agent profile configuration', () => {
      const state = {
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
      } as ToolStoreState;

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

      const autoVisible = builtinToolSelectors.installedProfileConfigurableMetaList({
        isManualMode: false,
      })(state);
      const autoExcluded = builtinToolSelectors.nonProfileConfigurableBuiltinToolIds({
        isManualMode: false,
      })(state);
      const manualVisible = builtinToolSelectors.installedProfileConfigurableMetaList({
        isManualMode: true,
      })(state);
      const manualExcluded = builtinToolSelectors.nonProfileConfigurableBuiltinToolIds({
        isManualMode: true,
      })(state);

      expect(autoVisible.map((item) => item.identifier)).toEqual([
        'lobe-agent-management',
        'profile-tool',
      ]);
      expect(autoExcluded).toEqual(
        expect.arrayContaining(['lobe-web-browsing', 'lobe-verify', 'lobe-skill-store']),
      );
      expect(manualVisible.map((item) => item.identifier)).toEqual([
        'lobe-skill-store',
        'lobe-agent-management',
        'profile-tool',
      ]);
      expect(manualExcluded).toEqual(expect.arrayContaining(['lobe-web-browsing', 'lobe-verify']));
      expect(manualExcluded).not.toContain('lobe-skill-store');
      expect(manualExcluded).not.toContain('lobe-agent-management');
    });
  });
});
