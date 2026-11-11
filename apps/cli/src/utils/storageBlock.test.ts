import { describe, expect, it, vi } from 'vitest';

import type { TrpcClient } from '../api/client';
import { describeStorageBlock } from './storageBlock';

const GB = 1024 ** 3;

const createClient = ({ quota, workspace }: { quota?: unknown; workspace?: unknown } = {}) =>
  ({
    file: {
      getStorageQuota: {
        query:
          quota === undefined
            ? vi.fn().mockRejectedValue(new Error('NOT_FOUND'))
            : vi.fn().mockResolvedValue(quota),
      },
    },
    workspace: { getById: { query: vi.fn().mockResolvedValue(workspace) } },
  }) as unknown as TrpcClient;

const SERVER = 'https://app.lobehub.com';
const blocked = (reason: string) => new Error(`storage_block:${reason}`);

describe('describeStorageBlock', () => {
  it('passes other errors through without querying the quota', async () => {
    const client = createClient();

    await expect(describeStorageBlock(client, new Error('fetch failed'), SERVER)).resolves.toBe(
      'fetch failed',
    );
    expect(client.file.getStorageQuota.query).not.toHaveBeenCalled();
  });

  it('states the remaining quota and both recovery links on one line', async () => {
    const line = await describeStorageBlock(
      createClient({ quota: { includedBytes: GB, remainingBytes: 0, usedBytes: 1.2 * GB } }),
      blocked('upgrade_required'),
      SERVER,
    );

    expect(line).toMatch(/^storage_block:upgrade_required\./);
    expect(line).toContain('0 B of 1.0 GB remaining (1.2 GB used)');
    expect(line).toContain('https://lobehub.com/resource');
    expect(line).toContain('https://lobehub.com/settings/plans');
    expect(line).toMatch(/do not retry/);
    expect(line).not.toContain('\n');
  });

  it('points billing rejections at storage settings instead of the plans page', async () => {
    const line = await describeStorageBlock(
      createClient({ quota: { includedBytes: GB, remainingBytes: 0, usedBytes: GB } }),
      blocked('overage_not_enabled'),
      SERVER,
    );

    expect(line).toContain('https://lobehub.com/settings/usage');
    expect(line).not.toContain('/settings/plans');
  });

  it('scopes links to the workspace that owns the quota', async () => {
    const line = await describeStorageBlock(
      createClient({
        quota: { includedBytes: GB, remainingBytes: 0, usedBytes: GB, workspaceId: 'ws_1' },
        workspace: { id: 'ws_1', slug: 'acme' },
      }),
      blocked('upgrade_required'),
      SERVER,
    );

    expect(line).toContain('https://lobehub.com/acme/resource');
    expect(line).toContain('https://lobehub.com/acme/settings/plans');
    expect(line).toMatch(/workspace owner or admin/);
  });

  it('names no page when the quota lookup fails, since the scope is unknown', async () => {
    const line = await describeStorageBlock(
      createClient(),
      blocked('upgrade_required'),
      'http://localhost:3010',
    );

    expect(line).toMatch(/^storage_block:upgrade_required\./);
    expect(line).not.toContain('remaining');
    expect(line).not.toContain('http://');
    expect(line).toMatch(/current scope/);
  });

  it('names no personal page when the workspace cannot be verified', async () => {
    const line = await describeStorageBlock(
      createClient({
        quota: { includedBytes: GB, remainingBytes: 0, usedBytes: GB, workspaceId: 'ws_1' },
        workspace: null,
      }),
      blocked('upgrade_required'),
      SERVER,
    );

    expect(line).toContain('0 B of 1.0 GB remaining');
    expect(line).not.toContain('https://');
    expect(line).toMatch(/workspace owner or admin/);
  });
});
