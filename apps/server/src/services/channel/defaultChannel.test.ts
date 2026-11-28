// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createAgentDirectChannel,
  createDefaultChannel,
  DEFAULT_CHANNEL_TITLE,
} from './defaultChannel';

const { ChannelServiceCtor, createDefault, createDirect, getFlags, onAgentCreated } = vi.hoisted(
  () => ({
    ChannelServiceCtor: vi.fn(),
    createDefault: vi.fn(),
    createDirect: vi.fn(),
    getFlags: vi.fn(),
    onAgentCreated: vi.fn(),
  }),
);
vi.mock('@/business/server/channel/onAgentCreated', () => ({ onAgentCreated }));
vi.mock('@/server/featureFlags', () => ({ getServerFeatureFlagsStateFromRuntimeConfig: getFlags }));
vi.mock('./ChannelService', () => ({
  ChannelService: vi.fn(function (...args: unknown[]) {
    ChannelServiceCtor(...args);
    return { createDefault, createDirect };
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
    'still opens the project Channel while `channel` is %s for the creator',
    async (flag) => {
      getFlags.mockResolvedValue({ enableChannels: flag });
      await createDefaultChannel({ ...params, projectId: 'pro_1', workspaceId: 'ws_1' });
      expect(createDefault).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: 'pro_1', title: DEFAULT_CHANNEL_TITLE }),
      );
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
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ agentId: 'agt_main', userId: 'owner' }),
    );
    error.mockRestore();
  });
});

describe('createAgentDirectChannel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getFlags.mockResolvedValue({ enableChannels: true });
    createDirect.mockResolvedValue({ channel: { id: 'chn_1' } });
    onAgentCreated.mockResolvedValue(undefined);
  });

  it.each([false, undefined])(
    'creates nothing while `channel` is %s for the creator',
    async (flag) => {
      getFlags.mockResolvedValue({ enableChannels: flag });
      await createAgentDirectChannel({ ...params, workspaceId: 'ws_1' });
      expect(getFlags).toHaveBeenCalledWith('owner');
      expect(ChannelServiceCtor).not.toHaveBeenCalled();
      expect(createDirect).not.toHaveBeenCalled();
      expect(onAgentCreated).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, 'ws_1'])(
    "opens the creator's direct Channel to the new Agent in scope %s",
    async (workspaceId) => {
      await createAgentDirectChannel({ ...params, workspaceId });
      expect(ChannelServiceCtor).toHaveBeenCalledWith(db, 'owner', workspaceId);
      // Bound to no device; the Agent runs where its own settings say.
      expect(createDirect).toHaveBeenCalledWith('agt_main');
      expect(createDefault).not.toHaveBeenCalled();
    },
  );

  it('never fails the Agent creation it follows', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    createDirect.mockRejectedValue(new Error('connection reset'));
    await expect(createAgentDirectChannel(params)).resolves.toBeUndefined();
    getFlags.mockRejectedValue(new Error('config unavailable'));
    await expect(createAgentDirectChannel(params)).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ agentId: 'agt_main', userId: 'owner' }),
    );
    error.mockRestore();
  });

  it('hands the new Agent to the onAgentCreated slot after its direct Channel', async () => {
    await createAgentDirectChannel({ ...params, workspaceId: 'ws_1' });
    expect(onAgentCreated).toHaveBeenCalledWith({
      agentId: 'agt_main',
      db,
      userId: 'owner',
      workspaceId: 'ws_1',
    });
    expect(createDirect.mock.invocationCallOrder[0]).toBeLessThan(
      onAgentCreated.mock.invocationCallOrder[0],
    );
  });

  it('still runs the slot when the direct Channel fails, and reports each failure', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    createDirect.mockRejectedValue(new Error('connection reset'));
    onAgentCreated.mockRejectedValue(new Error('seed failed'));
    await expect(createAgentDirectChannel(params)).resolves.toBeUndefined();
    expect(onAgentCreated).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });

  it('skips the slot when the flag cannot be read', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    getFlags.mockRejectedValue(new Error('config unavailable'));
    await expect(createAgentDirectChannel(params)).resolves.toBeUndefined();
    expect(onAgentCreated).not.toHaveBeenCalled();
    error.mockRestore();
  });
});
