import {
  CloudSandboxExecutionRuntime,
  CloudSandboxIdentifier,
} from '@lobechat/builtin-tool-cloud-sandbox';

import { UserModel } from '@/database/models/user';
import { FileService } from '@/server/services/file';
import { MarketService } from '@/server/services/market';
import { createSandboxService } from '@/server/services/sandbox';

import { type ServerRuntimeRegistration } from './types';

/**
 * CloudSandbox Server Runtime
 * Per-request runtime (needs topicId, userId)
 */
export const cloudSandboxRuntime: ServerRuntimeRegistration = {
  factory: async (context) => {
    if (!context.userId || !context.topicId) {
      throw new Error('userId and topicId are required for Cloud Sandbox execution');
    }

    if (!context.serverDB) {
      throw new Error('serverDB is required for Cloud Sandbox execution');
    }

    // Read market accessToken from DB so server-side sandbox runtime can authenticate.
    let accessToken: string | undefined;
    try {
      const userModel = new UserModel(context.serverDB, context.userId);
      const settings = await userModel.getUserSettings();
      accessToken = (settings?.market as any)?.accessToken;
    } catch {
      // non-fatal — MarketService will fall back to trustedClientToken
    }

    const marketService = new MarketService({
      accessToken,
      userInfo: { userId: context.userId },
    });
    const fileService = new FileService(context.serverDB, context.userId, context.workspaceId);
    const sandboxService = createSandboxService({
      fileService,
      marketService,
      serverDB: context.serverDB,
      topicId: context.topicId,
      userId: context.userId,
    });

    return new CloudSandboxExecutionRuntime(sandboxService);
  },
  identifier: CloudSandboxIdentifier,
};
