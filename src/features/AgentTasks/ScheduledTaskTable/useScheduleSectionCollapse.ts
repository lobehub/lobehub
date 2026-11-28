import { useTaskListGroupCollapse } from '../AgentTaskList/useTaskListGroupCollapse';

/** Grouping name the folded sections are stored under, beside the list's own groupings. */
const SCHEDULE_GROUP_BY = 'schedule';

/**
 * Folded sections of the scheduled table, persisted with the task list's
 * folded groups so a folded section stays folded across navigation and
 * reloads.
 */
export const useScheduleSectionCollapse = (collapseScope: string) =>
  useTaskListGroupCollapse(collapseScope, SCHEDULE_GROUP_BY, 'none');
