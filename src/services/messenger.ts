import type { MessengerOversizeImageStrategy } from '@lobechat/const';

import { lambdaClient } from '@/libs/trpc/client';

type MessengerPlatform = 'telegram' | 'slack' | 'discord' | 'wechat';

class MessengerService {
  availablePlatforms = async () => {
    return lambdaClient.messenger.availablePlatforms.query();
  };

  peekLinkToken = async (randomId: string) => {
    return lambdaClient.messenger.peekLinkToken.query({ randomId });
  };

  listAgentsForBinding = async (workspaceId?: string | null) => {
    return lambdaClient.messenger.listAgentsForBinding.query({ workspaceId: workspaceId ?? null });
  };

  listBindingScopes = async () => {
    return lambdaClient.messenger.listBindingScopes.query();
  };

  confirmLink = async (params: { initialAgentId: string; randomId: string }) => {
    return lambdaClient.messenger.confirmLink.mutate(params);
  };

  getMyLink = async (platform: MessengerPlatform, tenantId?: string) => {
    return lambdaClient.messenger.getMyLink.query({ platform, tenantId });
  };

  listMyLinks = async () => {
    return lambdaClient.messenger.listMyLinks.query();
  };

  setActiveAgent = async (params: {
    agentId: string | null;
    platform: MessengerPlatform;
    tenantId?: string;
  }) => {
    return lambdaClient.messenger.setActiveAgent.mutate(params);
  };

  unlink = async (params: { platform: MessengerPlatform; tenantId?: string }) => {
    return lambdaClient.messenger.unlink.mutate(params);
  };

  listMyInstallations = async () => {
    return lambdaClient.messenger.listMyInstallations.query();
  };

  uninstallInstallation = async (params: { installationId: string }) => {
    return lambdaClient.messenger.uninstallInstallation.mutate(params);
  };

  createWechatQrSession = async () => {
    return lambdaClient.messenger.createWechatQrSession.mutate();
  };

  pollWechatQrSession = async (sessionId: string) => {
    return lambdaClient.messenger.pollWechatQrSession.mutate({ sessionId });
  };

  getMessengerPushWindow = async (platform: MessengerPlatform, tenantId?: string) => {
    return lambdaClient.messenger.getMessengerPushWindow.query({ platform, tenantId });
  };

  sendMessengerPush = async (params: {
    /**
     * Referenced by id only — the server resolves each file to a stable access
     * URL from the owned row. Deliberately no caller-supplied URL: the platform
     * senders fetch it server-side.
     */
    attachments?: {
      fileId: string;
      type: 'image' | 'file' | 'video' | 'audio';
    }[];
    content?: string;
    /**
     * What to do with an image the platform will not take at full size:
     * recompress it (default) or send the original as a download link.
     */
    oversizeImageStrategy?: MessengerOversizeImageStrategy;
    platform: MessengerPlatform;
    tenantId?: string;
  }) => {
    return lambdaClient.messenger.sendMessengerPush.mutate(params);
  };
}

export const messengerService = new MessengerService();
