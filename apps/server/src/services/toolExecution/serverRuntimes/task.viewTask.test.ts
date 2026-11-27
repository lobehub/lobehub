import { describe, expect, it, vi } from 'vitest';

import { createTaskRuntime } from './task';

vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'https://app.lobehub.com' } }));
vi.mock('@/server/routers/lambda/task', () => ({ taskRouter: { createCaller: vi.fn() } }));
vi.mock('@/server/services/task', () => ({ TaskService: vi.fn() }));

const body = ['## 去重台账', '- #101 已处理', `- ${'z'.repeat(1500)}`].join('\n');

const setup = () => {
  const detail = {
    activities: [
      {
        author: { id: 'user_1', name: 'Arvin', type: 'user' },
        content: body,
        id: 'cmt_v6',
        time: '2026-11-04T01:02:00.000Z',
        type: 'comment',
      },
    ],
    id: 'task_1',
    identifier: 'T-2670',
    instruction: 'patrol',
    status: 'running',
  };
  return createTaskRuntime({
    agentModel: {} as never,
    taskCaller: {} as never,
    taskId: 'task_1',
    taskModel: { resolve: async () => ({ id: 'task_1', identifier: 'T-2670' }) } as never,
    taskService: { getTaskDetail: vi.fn().mockResolvedValue(detail) } as never,
  });
};

describe('viewTask comment bodies', () => {
  it('lists comment bodies in Activities and returns a full comment by commentId', async () => {
    const runtime = setup();

    const overview = await runtime.viewTask({ identifier: 'T-2670' });
    expect(overview.content).toContain('👤 user Arvin  cmt_v6');
    expect(overview.content).toContain('      - #101 已处理');
    expect(overview.content).toContain('commentId: "cmt_v6"');

    const full = await runtime.viewTask({ commentId: 'cmt_v6', identifier: 'T-2670' });
    expect(full).toMatchObject({
      state: { identifier: 'T-2670', taskId: 'task_1' },
      success: true,
    });
    expect(full.content).toContain('Time: 2026-11-04T01:02:00.000Z');
    expect(full.content).toContain(body);
  });

  it('reports an unknown commentId instead of the task overview', async () => {
    const result = await setup().viewTask({ commentId: 'cmt_missing', identifier: 'T-2670' });
    expect(result).toMatchObject({ success: false });
    expect(result.content).toContain('Comment not found on T-2670: cmt_missing');
  });
});
