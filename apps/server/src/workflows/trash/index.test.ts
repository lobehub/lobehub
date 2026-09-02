// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { qstashClient } from '@/libs/qstash';

import { triggerTrashPurge } from './index';

vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'https://example.com' } }));
vi.mock('@/libs/qstash', () => ({ qstashClient: { publishJSON: vi.fn() } }));

describe('triggerTrashPurge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('reports unavailable without publishing when QStash is not configured', async () => {
    vi.stubEnv('QSTASH_TOKEN', '');

    await expect(triggerTrashPurge()).resolves.toBe(false);
    expect(qstashClient.publishJSON).not.toHaveBeenCalled();
  });

  it('propagates a rejected publish', async () => {
    vi.stubEnv('QSTASH_TOKEN', 'test-token');
    vi.mocked(qstashClient.publishJSON).mockRejectedValue(new Error('publish rejected'));

    await expect(triggerTrashPurge()).rejects.toThrow('publish rejected');
  });
});
