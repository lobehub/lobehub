// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDefaultChannel, DEFAULT_CHANNEL_TITLE } from './defaultChannel';

const { ChannelServiceCtor, createDefault, getFlags } = vi.hoisted(() => ({
  ChannelServiceCtor: vi.fn(),
  createDefault: vi.fn(),
  getFlags: vi.fn(),
}));
vi.mock('@/server/featureFlags', () => ({ getServerFeatureFlagsStateFromRuntimeConfig: getFlags }));
vi.mock('./ChannelService', () => ({
  ChannelService: vi.fn(function (...args: unknown[]) {
    ChannelServiceCtor(...args);
    return { createDefault };
  }),
}));

const db = {} as never;
const params = { agentId: 'agt_main', db, userId: 'owner' };

describe('createDefaultChannel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getFlags.mockResolvedValue({ enableChannels: true });
    createDefault.mockResolvedValue({ channel: { id: 'chn_1' } });
  });

  it.each([false, undefined])(
    'creates nothing while `channel` is %s for the creator',
    async (flag) => {
      getFlags.mockResolvedValue({ enableChannels: flag });
      await createDefaultChannel({ ...params, projectId: 'pro_1', workspaceId: 'ws_1' });
      expect(getFlags).toHaveBeenCalledWith('owner');
      expect(createDefault).not.toHaveBeenCalled();
    },
  );

  it('opens a General workspace Channel with the creator and the main Agent', async () => {
    await createDefaultChannel({ ...params, workspaceId: 'ws_1' });
    expect(ChannelServiceCtor).toHaveBeenCalledWith(db, 'owner', 'ws_1');
    expect(createDefault).toHaveBeenCalledWith({
      agentId: 'agt_main',
      projectId: undefined,
      title: 'General',
    });
  });

  it('groups a project Channel under the project in its own scope', async () => {
    await createDefaultChannel({ ...params, projectId: 'pro_1' });
    expect(ChannelServiceCtor).toHaveBeenCalledWith(db, 'owner', undefined);
    expect(createDefault).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'pro_1', title: DEFAULT_CHANNEL_TITLE }),
    );
  });

  it('never fails the creation it follows', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    createDefault.mockRejectedValue(new Error('connection reset'));
    await expect(createDefaultChannel(params)).resolves.toBeUndefined();
    getFlags.mockRejectedValue(new Error('config unavailable'));
    await expect(createDefaultChannel(params)).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ agentId: 'agt_main', userId: 'owner' }),
    );
    error.mockRestore();
  });
});
