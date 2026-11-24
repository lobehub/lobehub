import { COMMUNITY_SHOWCASE_LAYOUT } from '@lobechat/business-const';

import { isScheduledTasksWorkspace } from './isScheduledTasksWorkspace';

/**
 * Pages that own the whole content area, so the shell neither renders the
 * second-level panel nor reserves its width: the scheduled-task workspace, and
 * the showcase market, whose kinds are tabs in its own top bar.
 */
export const hidesNavPanel = (pathname: string, search: string) =>
  isScheduledTasksWorkspace(pathname, search) ||
  (COMMUNITY_SHOWCASE_LAYOUT && /\/community(?:\/|$)/.test(pathname));

/** The scheduled-task workspace draws its own list column where the panel would be. */
export const SCHEDULED_TASKS_COLUMN_WIDTH = 248;

/**
 * Width of the column a page that hides the panel draws in its place, 0 when
 * it draws none. The titlebar starts its tabs after that column, as it does
 * after the panel.
 */
export const pageNavColumnWidth = (pathname: string, search: string) =>
  isScheduledTasksWorkspace(pathname, search) ? SCHEDULED_TASKS_COLUMN_WIDTH : 0;
