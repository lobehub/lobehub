import { describe, expect, it } from 'vitest';

import {
  CreateTaskRequestSchema,
  TaskDetailSchema,
  TaskListResponseSchema,
  TaskRunSchema,
  TaskSchema,
  UpdateTaskRequestSchema,
} from './task.type';

// Services return the page's rows and total; the controller adds `hasMore`/`nextCursor`.
const SERVICE_PAGE_FIELDS = { hasMore: true, nextCursor: true } as const;

/**
 * A schedule the dispatcher cannot evaluate must be refused at the boundary:
 * `TaskService.createTask` assumes the caller already validated it, so an
 * accepted-but-unusable pattern is stored and then silently never fires.
 */
describe('task schedule field schemas', () => {
  it('rejects a create whose cron the dispatcher cannot evaluate', () => {
    expect(
      CreateTaskRequestSchema.safeParse({ instruction: 'ship it', schedulePattern: 'every day' })
        .success,
    ).toBe(false);
  });

  it('accepts a create with a standard cron pattern and IANA timezone', () => {
    expect(
      CreateTaskRequestSchema.safeParse({
        automationMode: 'schedule',
        instruction: 'ship it',
        schedulePattern: '0 9 * * 1-5',
        scheduleTimezone: 'Asia/Shanghai',
      }).success,
    ).toBe(true);
  });

  it('rejects a create with an unknown timezone', () => {
    expect(
      CreateTaskRequestSchema.safeParse({ instruction: 'ship it', scheduleTimezone: 'Mars/Phobos' })
        .success,
    ).toBe(false);
  });

  it('applies the same checks to a patch', () => {
    expect(UpdateTaskRequestSchema.safeParse({ schedulePattern: 'every day' }).success).toBe(false);
    expect(UpdateTaskRequestSchema.safeParse({ scheduleTimezone: 'Mars/Phobos' }).success).toBe(
      false,
    );
    expect(UpdateTaskRequestSchema.safeParse({ schedulePattern: '0 9 * * 1-5' }).success).toBe(
      true,
    );
    expect(UpdateTaskRequestSchema.safeParse({ schedulePattern: null }).success).toBe(true);
  });
});

describe('task project field schemas', () => {
  it('accepts a project id and null on a patch, and rejects a non-string', () => {
    expect(UpdateTaskRequestSchema.parse({ projectId: 'proj_1' })).toEqual({ projectId: 'proj_1' });
    expect(UpdateTaskRequestSchema.parse({ projectId: null })).toEqual({ projectId: null });
    expect(UpdateTaskRequestSchema.safeParse({ projectId: 42 }).success).toBe(false);
  });

  it('keeps an omitted project out of a patch, so it cannot overwrite the stored one', () => {
    expect(UpdateTaskRequestSchema.parse({ name: 'x' })).not.toHaveProperty('projectId');
  });
});

// A JSON round trip on purpose: `structuredClone` would keep the Dates the wire turns into strings.
// eslint-disable-next-line unicorn/prefer-structured-clone
const wire = <T>(value: T) => JSON.parse(JSON.stringify(value));
const now = new Date('2026-11-17T08:00:00.000Z');

const taskRow = {
  accessedAt: now,
  archivedAt: null,
  assigneeAgentId: 'agt-1',
  assigneeUserId: null,
  automationMode: null,
  completedAt: null,
  config: {},
  context: {},
  createdAt: now,
  createdByAgentId: null,
  createdByUserId: 'user-1',
  currentTopicId: null,
  deletedAt: null,
  description: null,
  editorData: null,
  error: null,
  heartbeatInterval: null,
  heartbeatTimeout: null,
  id: 'task-1',
  identifier: 'T-1',
  instruction: 'ship it',
  isDeleted: null,
  lastHeartbeatAt: null,
  maxTopics: null,
  name: 'Ship',
  parentTaskId: null,
  priority: 0,
  projectId: null,
  schedulePattern: null,
  scheduleTimezone: 'UTC',
  seq: 1,
  sortOrder: 0,
  startedAt: null,
  status: 'backlog',
  totalTopics: 0,
  updatedAt: now,
  visibility: 'public',
  workspaceId: null,
};

describe('task response schemas', () => {
  it('accepts a task row as it leaves the API', () => {
    expect(() => TaskSchema.parse(wire(taskRow))).not.toThrow();
  });

  it('accepts a list page with labels and subtask progress', () => {
    const page = {
      tasks: [
        {
          ...taskRow,
          labels: [{ color: '#f00', id: 'lbl-1', name: 'Bug' }],
          subtaskProgress: { completed: 1, total: 2 },
        },
      ],
      total: 1,
    };

    expect(() => TaskListResponseSchema.omit(SERVICE_PAGE_FIELDS).parse(wire(page))).not.toThrow();
  });

  it('accepts a detail with nested subtasks and a topic activity', () => {
    const detail = {
      activities: [{ status: 'completed', topicId: 'tpc-1', trigger: 'manual', type: 'topic' }],
      identifier: 'T-1',
      instruction: 'ship it',
      status: 'running',
      subtasks: [
        {
          children: [{ identifier: 'T-3', status: 'backlog' }],
          identifier: 'T-2',
          status: 'running',
        },
      ],
    };

    expect(() => TaskDetailSchema.parse(detail)).not.toThrow();
  });

  it('accepts a past run', () => {
    expect(() =>
      TaskRunSchema.parse(
        wire({
          agentId: 'agt-1',
          completedAt: now,
          content: null,
          createdAt: now,
          keyFindings: [],
          nextAction: null,
          notable: true,
          seq: 1,
          status: 'completed',
          summary: 'Done',
          title: 'Run 1',
          topicId: 'tpc-1',
          trigger: 'schedule',
        }),
      ),
    ).not.toThrow();
  });
});
