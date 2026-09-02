import { describe, expect, it } from 'vitest';

import type { TaskListItem } from '@/store/task/slices/list/initialState';

import {
  clampCollectionPage,
  getMyTaskViewOptions,
  getScheduledTaskViewOptions,
  getTaskCreateActionBehavior,
  getTaskPageHeaderVisibility,
  resolveMyTaskScope,
  resolveTaskCollection,
} from './AgentTasksPage';
import {
  collapseSubTasks,
  compareTaskItems,
  DEFAULT_TASK_LIST_VIEW_OPTIONS,
} from './listViewOptions';
import { shouldRenderTaskAgentPanelToggle } from './taskAgentPanelToggle';

const taskUpdatedAt = (id: string, updatedAt: string): TaskListItem =>
  ({ id, identifier: id, status: 'backlog', updatedAt: new Date(updatedAt) }) as TaskListItem;

describe('AgentTasksPage', () => {
  describe('clampCollectionPage', () => {
    it('moves a stale last page back into range when the result total shrinks', () => {
      expect(clampCollectionPage(2, 50)).toBe(1);
      expect(clampCollectionPage(3, 51)).toBe(2);
    });

    it('keeps the first page valid for an empty result', () => {
      expect(clampCollectionPage(1, 0)).toBe(1);
    });
  });

  describe('getScheduledTaskViewOptions', () => {
    it('keeps client sorting aligned with the updatedAt-desc server pagination and renders every fetched row', () => {
      expect(
        getScheduledTaskViewOptions({
          ...DEFAULT_TASK_LIST_VIEW_OPTIONS,
          orderBy: 'title',
          orderDirection: 'asc',
          showSubTasks: false,
        }),
      ).toEqual({
        ...DEFAULT_TASK_LIST_VIEW_OPTIONS,
        groupBy: 'automationMode',
        hideCompleted: false,
        orderBy: 'updatedAt',
        orderDirection: 'asc',
        showSubTasks: true,
      });
    });

    it('renders a page newest-first, like the server paginates it', () => {
      const options = getScheduledTaskViewOptions(DEFAULT_TASK_LIST_VIEW_OPTIONS);
      const newer = taskUpdatedAt('a', '2026-02-01');
      const older = taskUpdatedAt('b', '2026-01-01');
      expect(compareTaskItems(newer, older, options)).toBeLessThan(0);
    });
  });

  describe('getMyTaskViewOptions', () => {
    it('pins ordering to the updatedAt-desc server page, renders every fetched row, keeps the rest', () => {
      expect(
        getMyTaskViewOptions({
          ...DEFAULT_TASK_LIST_VIEW_OPTIONS,
          groupBy: 'priority',
          hideCompleted: false,
          orderBy: 'title',
          orderDirection: 'asc',
          showSubTasks: false,
        }),
      ).toEqual({
        ...DEFAULT_TASK_LIST_VIEW_OPTIONS,
        groupBy: 'priority',
        hideCompleted: false,
        orderBy: 'updatedAt',
        orderDirection: 'asc',
        showSubTasks: true,
      });
    });

    it('never folds a fetched sub-task away, so a page is never sparser than the server sent it', () => {
      const options = getMyTaskViewOptions({
        ...DEFAULT_TASK_LIST_VIEW_OPTIONS,
        showSubTasks: false,
      });
      const parent = { ...taskUpdatedAt('p', '2026-02-01'), parentTaskId: null };
      const child = { ...taskUpdatedAt('c', '2026-02-02'), parentTaskId: 'p' };
      // `collapseSubTasks` is what `TaskList` applies when sub-tasks are hidden;
      // pinning `showSubTasks` keeps it out of the paginated path.
      expect(options.showSubTasks).toBe(true);
      expect(collapseSubTasks([parent, child]).map((t) => t.id)).toEqual(['p']);
    });

    it('renders a page newest-first, like the server paginates it', () => {
      const options = getMyTaskViewOptions(DEFAULT_TASK_LIST_VIEW_OPTIONS);
      const newer = taskUpdatedAt('a', '2026-02-01');
      const older = taskUpdatedAt('b', '2026-01-01');
      expect(compareTaskItems(newer, older, options)).toBeLessThan(0);
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

    it('opens "My tasks" only where the tab is offered', () => {
      const params = new URLSearchParams('collection=mine');
      expect(resolveTaskCollection(params, { allowMine: true })).toBe('mine');
      // Agent/project scopes and personal mode have no member assignment, so a
      // deep link into the tab lands on ordinary tasks instead of a blank view.
      expect(resolveTaskCollection(params, { allowMine: false })).toBe('tasks');
      expect(resolveTaskCollection(params)).toBe('tasks');
    });
  });

  describe('resolveMyTaskScope', () => {
    it('defaults to tasks assigned to me', () => {
      expect(resolveMyTaskScope(new URLSearchParams())).toBe('assigned');
      expect(resolveMyTaskScope(new URLSearchParams('scope=unknown'))).toBe('assigned');
    });

    it('opens the created sub-view from its addressable URL', () => {
      expect(resolveMyTaskScope(new URLSearchParams('scope=created'))).toBe('created');
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

    it('keeps the breadcrumb for a project scope and drops it for the global list', () => {
      expect(
        getTaskPageHeaderVisibility({ isEmptyHero: false, isMobile: false, projectId: 'p-1' }),
      ).toEqual({
        showBreadcrumb: true,
        showTaskAgentPanelToggle: true,
        showViewOptions: true,
      });
      expect(getTaskPageHeaderVisibility({ isEmptyHero: false, isMobile: false })).toEqual({
        showBreadcrumb: false,
        showTaskAgentPanelToggle: true,
        showViewOptions: true,
      });
    });
  });
});
