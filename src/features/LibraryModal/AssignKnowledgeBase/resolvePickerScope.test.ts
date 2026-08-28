import { describe, expect, it } from 'vitest';

import { resolvePickerScope } from './resolvePickerScope';

describe('resolvePickerScope', () => {
  // Regression: `agents.visibility` defaults to 'public' and carries no meaning
  // in personal mode, so keying the public-agent branch off it alone showed the
  // "publish to workspace" hint to users who have no workspace at all, and
  // narrowed the fetch to rows that merely held the default value.
  describe('personal mode (no owning workspace)', () => {
    it('shows no workspace hint and sends no visibility filter', () => {
      expect(
        resolvePickerScope({ agentVisibility: 'public', agentWorkspaceId: null, mode: 'public' }),
      ).toEqual({
        effectiveVisibility: undefined,
        showPublicAgentHint: false,
        showVisibilityTabs: false,
      });
    });

    it('hides the visibility tabs — personal rows have no private/workspace split', () => {
      const scope = resolvePickerScope({
        agentVisibility: 'private',
        agentWorkspaceId: undefined,
        mode: 'private',
      });

      expect(scope.showVisibilityTabs).toBe(false);
      expect(scope.effectiveVisibility).toBeUndefined();
    });
  });

  describe('workspace agent', () => {
    it('forces the workspace scope and explains why for a public agent', () => {
      expect(
        resolvePickerScope({
          agentVisibility: 'public',
          agentWorkspaceId: 'ws-1',
          mode: 'private',
        }),
      ).toEqual({
        effectiveVisibility: 'public',
        showPublicAgentHint: true,
        showVisibilityTabs: false,
      });
    });

    it('follows the picked tab for a private agent', () => {
      expect(
        resolvePickerScope({
          agentVisibility: 'private',
          agentWorkspaceId: 'ws-1',
          mode: 'private',
        }),
      ).toEqual({
        effectiveVisibility: 'private',
        showPublicAgentHint: false,
        showVisibilityTabs: true,
      });
    });
  });
});
