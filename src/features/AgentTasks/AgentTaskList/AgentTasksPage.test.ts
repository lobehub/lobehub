import { describe, expect, it } from 'vitest';

import {
  clampScheduledPage,
  getScheduledTaskViewOptions,
  getTaskCreateActionBehavior,
  getTaskPageHeaderVisibility,
  resolveTaskCollection,
} from './AgentTasksPage';
import { DEFAULT_TASK_LIST_VIEW_OPTIONS } from './listViewOptions';
import { shouldRenderTaskAgentPanelToggle } from './taskAgentPanelToggle';

describe('AgentTasksPage', () => {
  describe('clampScheduledPage', () => {
    it('moves a stale last page back into range when the result total shrinks', () => {
      expect(clampScheduledPage(2, 50)).toBe(1);
      expect(clampScheduledPage(3, 51)).toBe(2);
    });

    it('keeps the first page valid for an empty result', () => {
      expect(clampScheduledPage(1, 0)).toBe(1);
    });
  });

  describe('getScheduledTaskViewOptions', () => {
    it('keeps client sorting aligned with the updatedAt-desc server pagination', () => {
      expect(
        getScheduledTaskViewOptions({
          ...DEFAULT_TASK_LIST_VIEW_OPTIONS,
          orderBy: 'title',
          orderDirection: 'asc',
          showSubTasks: true,
        }),
      ).toEqual({
        ...DEFAULT_TASK_LIST_VIEW_OPTIONS,
        groupBy: 'automationMode',
        hideCompleted: false,
        orderBy: 'updatedAt',
        orderDirection: 'desc',
        showSubTasks: true,
      });
    });
  });

  describe('resolveTaskCollection', () => {
    it('opens the scheduled collection from its addressable URL', () => {
      expect(resolveTaskCollection(new URLSearchParams('collection=scheduled'))).toBe('scheduled');
    });

    it('falls back to ordinary tasks for absent or unknown values', () => {
      expect(resolveTaskCollection(new URLSearchParams())).toBe('tasks');
      expect(resolveTaskCollection(new URLSearchParams('collection=unknown'))).toBe('tasks');
    });
  });

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
