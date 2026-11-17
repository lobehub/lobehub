import type { LobeChatDatabase } from '@lobechat/database';
import pMap from 'p-map';

import { removeAgentFromProjectChannels } from '@/database/repositories/channel';

import { ChannelCoordinator } from './ChannelCoordinator';
import { notifyChannel } from './notify';
import { wakeChannel } from './queue';

/**
 * An Agent removed from a project leaves the project's Channels: they seat only its own Agents.
 * The caller has already checked the right to manage the project's members.
 */
export const leaveProjectChannels = async (
  db: LobeChatDatabase,
  projectId: string,
  agentId: string,
) => {
  const { channelIds, writers } = await removeAgentFromProjectChannels(db, projectId, agentId);
  await new ChannelCoordinator(db).stopWriters(writers);
  await pMap(
    channelIds,
    (channelId) => Promise.all([wakeChannel(channelId), notifyChannel(db, channelId)]),
    { concurrency: 5 },
  );
};
