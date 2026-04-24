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
    it('should keep task tools hidden from manual tool selection', () => {
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
      expect(result.map((item) => item.identifier)).not.toContain('lobe-task');
    });
  });

  describe('installedAllMetaList', () => {
    it('should keep task tools out of agent profile configuration', () => {
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

      expect(result.map((item) => item.identifier)).toEqual(['tool-1']);
    });
  });
});
