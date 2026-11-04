/** Filter flags of `task list`, shared by the flat list and `--group-by`. */
export interface TaskListFilterOptions {
  agent?: string;
  archived?: boolean;
  completedWithin?: string;
  content?: string;
  parent?: string;
  priority?: string;
  project?: string;
  root?: boolean;
  status?: string;
}

export const splitValues = (value: string) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const readPriorities = (value: string) =>
  splitValues(value).map((item) => {
    if (!/^[0-4]$/.test(item)) {
      throw new Error(`Invalid priority "${item}". Must be 0-4 (comma-separated)`);
    }
    return Number.parseInt(item, 10);
  });

/** Options both `task.list` and `task.groupList` take under the same name. */
const toSharedInput = (options: TaskListFilterOptions, assigneeUserIds: string[]) => {
  const input: Record<string, any> = {};
  if (options.root) input.parentTaskId = null;
  if (options.parent) input.parentTaskId = options.parent;
  if (options.agent) input.assigneeAgentId = options.agent;
  if (options.archived) input.includeArchived = true;
  if (options.project) input.projectId = options.project;
  if (options.completedWithin) input.completedWithin = options.completedWithin;

  const filter: Record<string, any> = {};
  if (assigneeUserIds.length > 0) filter.assignee = { operator: 'is', values: assigneeUserIds };
  if (options.content) filter.content = options.content;
  if (Object.keys(filter).length > 0) input.filter = filter;
  return input;
};

export const toTaskListInput = (options: TaskListFilterOptions, assigneeUserIds: string[] = []) => {
  const input = toSharedInput(options, assigneeUserIds);
  if (options.status) input.statuses = splitValues(options.status);
  if (options.priority !== undefined) input.priorities = readPriorities(options.priority);
  return input;
};

/** `task.groupList` has no `statuses` / `priorities`; the same narrowing is its `filter`. */
export const toTaskGroupListInput = (
  groupBy: string,
  options: TaskListFilterOptions,
  assigneeUserIds: string[] = [],
) => {
  const input = toSharedInput(options, assigneeUserIds);
  const filter: Record<string, any> = { ...input.filter };
  if (options.status) filter.status = { operator: 'is', values: splitValues(options.status) };
  if (options.priority !== undefined) {
    filter.priority = { operator: 'is', values: readPriorities(options.priority) };
  }
  if (Object.keys(filter).length > 0) input.filter = filter;
  return { ...input, groupBy };
};
