import type { SdkClient } from '../../api/sdk';
import { getSdkClient } from '../../api/sdk';

/**
 * Task CRUD over the public REST API (`/api/v1/tasks`, `@lobehub/sdk`).
 *
 * Each helper only takes requests REST can express with the same semantics and
 * answers in the shape the tRPC procedure did, so the command's output stays
 * byte-for-byte the same. A request REST cannot express returns `undefined`
 * from the matching `canUse…` check and the caller keeps it on tRPC; those
 * gaps are listed in `packages/sdk/COVERAGE.md`.
 */

/** `GET /tasks` caps a page at 100; larger `--limit` values walk offset pages. */
const REST_PAGE_LIMIT = 100;

export interface TaskListInput {
  assigneeAgentId?: string;
  filter?: unknown;
  includeArchived?: boolean;
  limit?: number;
  offset?: number;
  parentTaskId?: string | null;
  statuses?: string[];
}

/** REST lists have no parent, archived or label filter. */
export const canListViaRest = (input: TaskListInput) =>
  input.parentTaskId === undefined && !input.includeArchived && input.filter === undefined;

/** `task.list`'s `{ data, total }`, read page by page from `GET /tasks`. */
export const listTasksViaRest = async (input: TaskListInput, sdk?: SdkClient) => {
  const client = sdk ?? (await getSdkClient());
  const want = input.limit ?? 50;
  let offset = input.offset ?? 0;
  const data: any[] = [];
  let total = 0;

  while (data.length < want) {
    const { data: body } = await client.tasks.list({
      query: {
        assigneeAgentId: input.assigneeAgentId,
        limit: Math.min(REST_PAGE_LIMIT, want - data.length),
        offset,
        statuses: input.statuses?.join(','),
      },
    });
    const page = body.data;
    data.push(...page.tasks);
    total = page.total;
    if (!page.hasMore || page.tasks.length === 0) break;
    offset += page.tasks.length;
  }

  return { data, total };
};

/** `task.detail`'s `{ data }`: both read `TaskService.getTaskDetail`. */
export const getTaskDetailViaRest = async (id: string, sdk?: SdkClient) => {
  const client = sdk ?? (await getSdkClient());
  const { data: body } = await client.tasks.get({ path: { id } });
  return { data: body.data as any };
};

export interface TaskCreateInput {
  assigneeAgentId?: string;
  assigneeUserId?: string;
  config?: Record<string, unknown>;
  context?: unknown;
  instruction: string;
  labelIds?: string[];
  name?: string;
  parentTaskId?: string;
  priority?: number;
}

/** REST create attaches neither labels nor an origin context. */
export const canCreateViaRest = (input: TaskCreateInput) =>
  !input.labelIds?.length && input.context === undefined;

export const createTaskViaRest = async (input: TaskCreateInput, sdk?: SdkClient) => {
  const client = sdk ?? (await getSdkClient());
  const { context: _context, labelIds: _labelIds, ...body } = input;
  const { data: res } = await client.tasks.create({ body });
  return { data: res.data as any };
};

/** Fields the REST patch takes; `heartbeatTimeout`, `configPatch` and `status` it does not. */
const REST_PATCH_FIELDS = new Set([
  'assigneeAgentId',
  'assigneeUserId',
  'description',
  'heartbeatInterval',
  'instruction',
  'name',
  'priority',
  'projectId',
]);

/** `input` is `task.update`'s, `id` included. */
export const canUpdateViaRest = (input: Record<string, unknown>) =>
  Object.keys(input).every((key) => key === 'id' || REST_PATCH_FIELDS.has(key));

export const updateTaskViaRest = async ({ id, ...body }: Record<string, any>, sdk?: SdkClient) => {
  const client = sdk ?? (await getSdkClient());
  const { data: res } = await client.tasks.update({ body, path: { id } });
  return { data: res.data as any };
};

/** `task.updateStatus`: REST nests the task under `task`, tRPC under `data`. */
export const updateTaskStatusViaRest = async (id: string, status: string, sdk?: SdkClient) => {
  const client = sdk ?? (await getSdkClient());
  const { data: res } = await client.tasks.updateStatus({
    body: { status: status as any },
    path: { id },
  });
  const { task, ...rest } = res.data;
  return { ...rest, data: task as any };
};

/**
 * `task.delete` answered with the deleted row; `DELETE /tasks/{id}` only with
 * its id, so the identifier the message prints is read first.
 */
export const deleteTaskViaRest = async (id: string, sdk?: SdkClient) => {
  const client = sdk ?? (await getSdkClient());
  const { data: detail } = await getTaskDetailViaRest(id, client);
  const { data: res } = await client.tasks.delete({ path: { id } });
  return { data: { ...detail, id: res.data.id } };
};
