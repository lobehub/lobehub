import { describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { resolveContentWorkspaceId, resolveTaskWorkspaceId } from '../resolveWorkspaceScope';

const createDb = (rows: Array<{ workspaceId: string | null }>) =>
  ({
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue(rows) })),
      })),
    })),
  }) as unknown as LobeChatDatabase;

describe('workspace scope recovery', () => {
  it('distinguishes a live personal task from a missing or trashed task', async () => {
    await expect(resolveTaskWorkspaceId(createDb([{ workspaceId: null }]), 'task-1')).resolves.toBe(
      undefined,
    );
    await expect(resolveTaskWorkspaceId(createDb([]), 'task-1')).rejects.toThrow(
      'missing or trashed task task-1',
    );
  });

  it('recovers a live task workspace and keeps no-task runs in personal scope', async () => {
    await expect(
      resolveTaskWorkspaceId(createDb([{ workspaceId: 'workspace-1' }]), 'task-1'),
    ).resolves.toBe('workspace-1');
    await expect(resolveTaskWorkspaceId(createDb([]), undefined)).resolves.toBe(undefined);
  });

  it('validates a supplied workspace against the live task anchor', async () => {
    await expect(
      resolveTaskWorkspaceId(createDb([{ workspaceId: 'workspace-1' }]), 'task-1', 'workspace-1'),
    ).resolves.toBe('workspace-1');
    await expect(
      resolveTaskWorkspaceId(createDb([{ workspaceId: 'workspace-2' }]), 'task-1', 'workspace-1'),
    ).rejects.toThrow('Task task-1 belongs to workspace workspace-2, not workspace-1');
  });

  it('fails closed when an anchored agent is missing or trashed', async () => {
    await expect(
      resolveContentWorkspaceId({ agentId: 'agent-1', serverDB: createDb([]) }),
    ).rejects.toThrow('missing or trashed agent agent-1');
  });
});
