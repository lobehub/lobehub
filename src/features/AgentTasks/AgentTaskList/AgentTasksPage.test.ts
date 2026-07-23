import { describe, expect, it } from 'vitest';

import { getTaskCreateActionBehavior, getTaskPageHeaderVisibility } from './AgentTasksPage';
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

  describe('getTaskPageHeaderVisibility', () => {
    it('hides empty global-task chrome that has no useful content yet', () => {
      expect(
        getTaskPageHeaderVisibility({ agentId: undefined, isEmptyHero: true, isMobile: false }),
      ).toEqual({
        showBreadcrumb: false,
        showTaskAgentPanelToggle: false,
        showViewOptions: false,
      });
    });

    it('keeps scoped task-list context when only the selected agent has no tasks', () => {
      expect(
        getTaskPageHeaderVisibility({ agentId: 'agent-1', isEmptyHero: true, isMobile: false }),
      ).toEqual({
        showBreadcrumb: true,
        showTaskAgentPanelToggle: true,
        showViewOptions: true,
      });
    });
  });
});
