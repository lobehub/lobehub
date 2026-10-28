import type { ChannelDetail, ChannelListItem } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

export interface ChannelAgentSelection {
  agentId: string;
  description?: string;
  deviceId?: string;
  name?: string;
  workingDirectory?: string;
}

export interface ChannelViewParams {
  before?: number;
  channelId: string;
  threadId?: string | null;
}

class ChannelService {
  archive = (channelId: string) => lambdaClient.channel.archive.mutate({ channelId });
  unarchive = (channelId: string) => lambdaClient.channel.unarchive.mutate({ channelId });
  archiveThread = (channelId: string, threadId: string) =>
    lambdaClient.channel.archiveThread.mutate({ channelId, threadId });
  unarchiveThread = (channelId: string, threadId: string) =>
    lambdaClient.channel.unarchiveThread.mutate({ channelId, threadId });
  agentEnvironment = async (channelId: string, memberId: string) =>
    (await lambdaClient.channel.agentEnvironment.query({ channelId, memberId })).data;
  updateAgentEnvironment = (
    channelId: string,
    memberId: string,
    environment: Pick<ChannelAgentSelection, 'deviceId' | 'workingDirectory'>,
  ) => lambdaClient.channel.updateAgentEnvironment.mutate({ channelId, environment, memberId });
  rename = (channelId: string, title: string) =>
    lambdaClient.channel.rename.mutate({ channelId, title });
  addUser = (channelId: string, userId: string) =>
    lambdaClient.channel.addUser.mutate({ channelId, userId });
  userCandidates = async (channelId: string, search: string) =>
    (await lambdaClient.channel.userCandidates.query({ channelId, search })).data;
  addAgent = (channelId: string, agent: ChannelAgentSelection) =>
    lambdaClient.channel.addAgent.mutate({ agent, channelId });
  create = (input: { agents: ChannelAgentSelection[]; projectId?: string; title: string }) =>
    lambdaClient.channel.create.mutate(input);
  detail = async (params: ChannelViewParams): Promise<ChannelDetail> =>
    (await lambdaClient.channel.detail.query(params)).data;
  list = async (): Promise<ChannelListItem[]> => (await lambdaClient.channel.list.query()).data;
  markRead = (channelId: string, sequence: number) =>
    lambdaClient.channel.markRead.mutate({ channelId, sequence });
  remove = (channelId: string) => lambdaClient.channel.remove.mutate({ channelId });
  removeThread = (channelId: string, threadId: string) =>
    lambdaClient.channel.removeThread.mutate({ channelId, threadId });
  send = (input: {
    channelId: string;
    content: string;
    fileIds?: string[];
    mentions: string[];
    requestKey: string;
    rootMessageId?: string;
    threadId?: string | null;
  }) => lambdaClient.channel.send.mutate(input);
  stop = (channelId: string, scope: { jobId: string } | { threadId: string | null }) =>
    lambdaClient.channel.stop.mutate({ channelId, scope });
}

export const channelService = new ChannelService();

/** A workspace member who can still be invited into a Channel. */
export type ChannelPersonOption = Awaited<ReturnType<typeof channelService.userCandidates>>[number];
