import type { TaskDetailData } from '@lobechat/types';
import { beforeEach, describe, expect, it } from 'vitest';

import { useTaskStore } from '@/store/task';

import { buildViewedTaskPrompt, withHeteroContext } from './viewedTaskPrompt';

const taskDetail: TaskDetailData = {
  identifier: 'T-858',
  instruction: 'Make images in the task content draggable',
  name: 'Task content images cannot be dragged',
  status: 'running',
};

const detailContext = {
  defaultTaskAssigneeAgentId: 'agt_inbox',
  viewedTask: { taskId: 'T-858', type: 'detail' as const },
};

describe('buildViewedTaskPrompt', () => {
  beforeEach(() => {
    useTaskStore.setState({ taskDetailMap: { 'T-858': taskDetail } });
  });

  it('describes the viewed task detail', () => {
    const prompt = buildViewedTaskPrompt(detailContext);

    expect(prompt).toContain('The user is currently viewing the detail page of task T-858');
    expect(prompt).toContain('Default Lobe AI agent id: agt_inbox');
  });

  it('returns undefined before the viewed task loads or outside Tasks', () => {
    useTaskStore.setState({ taskDetailMap: {} });

    expect(buildViewedTaskPrompt(detailContext)).toBeUndefined();
    expect(buildViewedTaskPrompt({})).toBeUndefined();
    expect(buildViewedTaskPrompt(undefined)).toBeUndefined();
  });
});

describe('buildViewedTaskPrompt for the task list', () => {
  const listContext = { viewedTask: { type: 'list' as const } };

  const viewList = (filtered: boolean) =>
    useTaskStore.setState({
      activeTaskListFiltered: filtered,
      activeTaskListKey: 'list',
      taskListMap: {
        list: {
          items: [{ identifier: 'T-1', name: 'Fix menu', priority: 2, status: 'running' }],
          total: 1,
        },
      } as any,
    });

  it('tells the agent a filtered list is not every task', () => {
    viewList(true);
    expect(buildViewedTaskPrompt(listContext)).toContain('with a filter applied');
  });

  it('keeps the plain list hint without a filter', () => {
    viewList(false);
    expect(buildViewedTaskPrompt(listContext)).toContain('Do NOT call listTasks');
  });
});

describe('withHeteroContext', () => {
  beforeEach(() => {
    useTaskStore.setState({ taskDetailMap: { 'T-858': taskDetail } });
  });

  it('appends the viewed task to the agent system context', () => {
    const systemContext = withHeteroContext(' Agent rules ', 'Which task is this?', detailContext);

    expect(systemContext).toMatch(/^Agent rules\n\n<page_context>/);
    expect(systemContext).toContain('Make images in the task content draggable');
  });

  it('keeps the agent system context as is outside Tasks', () => {
    expect(withHeteroContext('Agent rules', 'hello', {})).toBe('Agent rules');
    expect(withHeteroContext(undefined, 'hello', {})).toBeUndefined();
  });

  it('still carries the /goal instructions', () => {
    expect(withHeteroContext(undefined, '/goal ship it', detailContext)).toContain('T-858');
    expect(withHeteroContext(undefined, '/goal ship it', {})).toBeTruthy();
  });
});
