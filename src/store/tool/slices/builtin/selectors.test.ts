import { describe, expect, it } from 'vitest';

import type {ToolStoreState } from '../../initialState';
import { initialState } from '../../initialState';
import { builtinToolSelectors } from './selectors';

describe('builtinToolSelectors', () => {
  describe('metaList', () => {
    it('should return meta list excluding Dalle when showDalle is false', () => {
      const state = {
        ...initialState,
        builtinTools: [{ identifier: 'tool-1', manifest: { meta: { title: 'Tool 1' } } }],
      } as ToolStoreState;
      const result = builtinToolSelectors.metaList(state);
      expect(result).toEqual([
        { author: 'LobeHub', identifier: 'tool-1', meta: { title: 'Tool 1' }, type: 'builtin' },
      ]);
    });

    it('should hide tool when not need visible with hidden', () => {
      const state = {
        ...initialState,
        builtinTools: [
          { identifier: 'tool-1', hidden: true, manifest: { meta: { title: 'Tool 1' } } },
        ],
      } as ToolStoreState;
      const result = builtinToolSelectors.metaList(state);
      expect(result).toEqual([]);
    });

    it('should return an empty list if no builtin tools are available', () => {
      const state: ToolStoreState = {
        ...initialState,
        builtinTools: [],
      };
      const result = builtinToolSelectors.metaList(state);
      expect(result).toEqual([]);
    });
  });
});
