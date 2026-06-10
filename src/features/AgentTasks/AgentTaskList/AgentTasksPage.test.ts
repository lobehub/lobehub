import { describe, expect, it } from 'vitest';

import { getTaskCreateActionBehavior } from './AgentTasksPage';
import { shouldRenderTaskAgentPanelToggle } from './taskAgentPanelToggle';

describe('AgentTasksPage', () => {
  describe('getTaskCreateActionBehavior', () => {
    it('should allow workspace viewers to reopen the collapsed inline entry in list view', () => {
      expect(
        getTaskCreateActionBehavior({
          canCreateTask: false,
          inlineCollapsed: true,
          viewMode: 'list',
        }),
      ).toEqual({ disabled: false, mode: 'inline' });
    });

    it('should keep the modal create action disabled for workspace viewers in kanban view', () => {
      expect(
        getTaskCreateActionBehavior({
          canCreateTask: false,
          inlineCollapsed: false,
          viewMode: 'kanban',
        }),
      ).toEqual({ disabled: true, mode: 'modal' });
    });
  });

  describe('shouldRenderTaskAgentPanelToggle', () => {
    it('should render the task agent panel toggle on desktop layouts', () => {
      expect(shouldRenderTaskAgentPanelToggle(false)).toBe(true);
    });

    it('should hide the task agent panel toggle on mobile layouts', () => {
      expect(shouldRenderTaskAgentPanelToggle(true)).toBe(false);
    });
  });
});
