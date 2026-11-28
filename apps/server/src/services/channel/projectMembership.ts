import type { LobeChatDatabase } from '@lobechat/database';
import pMap from 'p-map';

import { projectChannelIds, removeAgentFromProjectChannels } from '@/database/repositories/channel';

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

/**
 * Deletes a project through `remove` (`ProjectRepository.delete`), then tells the members of each
 * of its Channels. The Channels stay, now standalone and possibly named after the project, so every
 * member's sidebar re-reads them instead of waiting for its idle poll. Nothing is sent when
 * `remove` deleted nothing.
 */
export const deleteProjectKeepingChannels = async <T>(
  db: LobeChatDatabase,
  projectId: string,
  remove: () => Promise<T | null>,
): Promise<T | null> => {
  // Read before the delete: afterwards nothing links the Channels to the project.
  const channelIds = await projectChannelIds(db, projectId);
  const deleted = await remove();
  if (deleted)
    await pMap(channelIds, (channelId) => notifyChannel(db, channelId), { concurrency: 5 });
  return deleted;
};
