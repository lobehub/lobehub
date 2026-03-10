import {
  CloudSandboxExecutionRuntime,
  CloudSandboxIdentifier,
} from '@lobechat/builtin-tool-cloud-sandbox';

import { UserModel } from '@/database/models/user';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { FileService } from '@/server/services/file';
import { MarketService } from '@/server/services/market';
import { ServerSandboxService } from '@/server/services/sandbox';

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

    // Align cron/server runtime auth with market router auth strategy:
    // prefer user access token from DB, and include full trusted-client user info.
    const user = await UserModel.findById(context.serverDB, context.userId);
    const userModel = new UserModel(context.serverDB, context.userId);
    const userSettings = await userModel.getUserSettings();
    const marketAccessToken = (userSettings?.market as any)?.accessToken;

    let keyVaults: Record<string, any> = {};

    try {
      keyVaults = await KeyVaultsGateKeeper.getUserKeyVaults(
        (userSettings?.keyVaults as string | null) || null,
        context.userId,
      );
    } catch {
      // Ignore keyVault decryption failures, sandbox execution can still proceed.
    }

    const marketService = new MarketService({
      accessToken: marketAccessToken,
      userInfo: {
        email: user?.email || undefined,
        name: user?.fullName || user?.username || undefined,
        userId: context.userId,
      },
    });
    const fileService = new FileService(context.serverDB, context.userId);
    const sandboxService = new ServerSandboxService({
      fileService,
      keyVaults,
      marketService,
      topicId: context.topicId,
      userId: context.userId,
    });

    return new CloudSandboxExecutionRuntime(sandboxService);
  },
  identifier: CloudSandboxIdentifier,
};
