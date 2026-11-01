import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BriefModel } from '@/database/models/brief';

import { briefRuntime } from '../brief';

vi.mock('@/database/models/brief');
vi.mock('@/database/models/task');

describe('briefRuntime', () => {
  const create = vi.fn();

  beforeEach(() => {
    create.mockReset();
    vi.mocked(BriefModel).mockImplementation(function () {
      return { create } as never;
    });
  });

  it('validates a trashed task before writing when workspace context is present', async () => {
    const limit = vi.fn().mockResolvedValue([]);
    const serverDB = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({ where: vi.fn(() => ({ limit })) })),
      })),
    };
    const runtime = briefRuntime.factory({
      agentId: 'agent-1',
      serverDB,
      taskId: 'trashed-task',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    } as never);

    await expect(
      runtime.createBrief({
        summary: 'Must not persist',
        title: 'Blocked brief',
        type: 'info',
      }),
    ).rejects.toThrow('missing or trashed task trashed-task');
    expect(create).not.toHaveBeenCalled();
  });
});
