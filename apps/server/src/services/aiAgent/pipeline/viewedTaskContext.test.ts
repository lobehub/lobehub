import type { TaskDetailData } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskModel } from '@/database/models/task';
import { TaskDetailService } from '@/server/services/task/detail';

import { buildViewedTaskContextPrompt, joinSystemContext } from './viewedTaskContext';

const deps = { db: {} as any, userId: 'user-1' };

const taskDetail: TaskDetailData = {
  identifier: 'T-858',
  instruction: 'Make images in the task content draggable',
  name: 'Task content images cannot be dragged',
  priority: 3,
  status: 'running',
};

describe('buildViewedTaskContextPrompt', () => {
  let getTaskDetail: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.spyOn(TaskModel.prototype, 'resolve').mockImplementation(
      async (ref) => ({ id: ref }) as never,
    );
    getTaskDetail = vi
      .spyOn(TaskDetailService.prototype, 'getTaskDetail')
      .mockResolvedValue(taskDetail as never);
  });
  afterEach(() => vi.restoreAllMocks());

  it('resolves legacy route identifiers before the ID-only detail read', async () => {
    vi.mocked(TaskModel.prototype.resolve).mockResolvedValue({ id: 'task_858' } as never);
    getTaskDetail.mockImplementation(async (id) => (id === 'task_858' ? taskDetail : null));
    const prompt = await buildViewedTaskContextPrompt(deps, { scope: 'task' }, 'T-858');
    expect(prompt).toContain('The user is currently viewing the detail page of task T-858');
  });

  it('does not read a detail for an invisible legacy reference', async () => {
    vi.mocked(TaskModel.prototype.resolve).mockResolvedValue(null);
    const prompt = await buildViewedTaskContextPrompt(
      deps,
      { defaultTaskAssigneeAgentId: 'agt_inbox', scope: 'task' },
      'T-858',
    );
    expect(getTaskDetail).not.toHaveBeenCalled();
    expect(prompt).toContain('Default Lobe AI agent id: agt_inbox');
  });

  it('describes the task viewed on a task detail page', async () => {
    const prompt = await buildViewedTaskContextPrompt(
      deps,
      { defaultTaskAssigneeAgentId: 'agt_inbox', scope: 'task' },
      'task-row-1',
    );

    expect(getTaskDetail).toHaveBeenCalledWith('task-row-1');
    expect(prompt).toContain('The user is currently viewing the detail page of task T-858');
    expect(prompt).toContain('Make images in the task content draggable');
    expect(prompt).toContain('Default Lobe AI agent id: agt_inbox');
  });

  it('keeps only the assignee defaults on the task list', async () => {
    const prompt = await buildViewedTaskContextPrompt(
      deps,
      { defaultTaskAssigneeAgentId: 'agt_inbox', scope: 'task' },
      undefined,
    );

    expect(getTaskDetail).not.toHaveBeenCalled();
    expect(prompt).toContain('Default Lobe AI agent id: agt_inbox');
    expect(prompt).not.toContain('<task>');
  });

  it('falls back to the assignee defaults when the task cannot be loaded', async () => {
    getTaskDetail.mockRejectedValue(new Error('db down'));

    const prompt = await buildViewedTaskContextPrompt(
      deps,
      { defaultTaskAssigneeAgentId: 'agt_inbox', scope: 'task' },
      'task-row-1',
    );

    expect(prompt).toContain('Default Lobe AI agent id: agt_inbox');
    expect(prompt).not.toContain('T-858');
  });

  it('ignores task ids outside the Tasks side conversation', async () => {
    // Task runs carry their own task prompt; only the side chat gets this one.
    expect(await buildViewedTaskContextPrompt(deps, { topicId: 'topic-1' }, 'task-row-1')).toBe(
      undefined,
    );
    expect(await buildViewedTaskContextPrompt(deps, undefined, 'task-row-1')).toBe(undefined);
    expect(getTaskDetail).not.toHaveBeenCalled();
  });
});

describe('joinSystemContext', () => {
  it('joins the non-empty parts', () => {
    expect(joinSystemContext(' agent rules ', undefined, 'task')).toBe('agent rules\n\ntask');
  });

  it('returns undefined when nothing remains', () => {
    expect(joinSystemContext(undefined, '  ')).toBe(undefined);
  });
});
