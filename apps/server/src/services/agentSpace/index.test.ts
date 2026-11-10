// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { migrateAgentSpace } from './index';

const { flags, migrateBatch } = vi.hoisted(() => ({
  flags: vi.fn(),
  migrateBatch: vi.fn(),
}));

vi.mock('@/database/repositories/agentSpace', () => ({
  AgentSpaceRepository: class {
    migrateBatch = migrateBatch;
  },
}));
vi.mock('@/server/featureFlags', () => ({
  getServerFeatureFlagsStateFromRuntimeConfig: flags,
}));

const params = { agentId: 'agt_1', db: {} as LobeChatDatabase, userId: 'user-1' };

describe('migrateAgentSpace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    flags.mockResolvedValue({ enableAgentKnowledgeSpace: true });
  });

  it('does nothing while the flag is off', async () => {
    flags.mockResolvedValue({ enableAgentKnowledgeSpace: false });

    await expect(migrateAgentSpace(params)).resolves.toBe(0);
    expect(migrateBatch).not.toHaveBeenCalled();
  });

  it('stops as soon as the agent is done', async () => {
    migrateBatch
      .mockResolvedValueOnce({ done: false, migrated: 200, skipped: false })
      .mockResolvedValueOnce({ done: true, migrated: 3, skipped: false });

    await expect(migrateAgentSpace(params)).resolves.toBe(203);
    expect(migrateBatch).toHaveBeenCalledTimes(2);
  });

  it('stops when another batch holds the agent', async () => {
    migrateBatch.mockResolvedValue({ done: false, migrated: 0, skipped: true });

    await expect(migrateAgentSpace(params)).resolves.toBe(0);
    expect(migrateBatch).toHaveBeenCalledTimes(1);
  });

  it('bounds the work of one access', async () => {
    migrateBatch.mockResolvedValue({ done: false, migrated: 200, skipped: false });

    await expect(migrateAgentSpace(params)).resolves.toBe(1000);
    expect(migrateBatch).toHaveBeenCalledTimes(5);
  });
});
