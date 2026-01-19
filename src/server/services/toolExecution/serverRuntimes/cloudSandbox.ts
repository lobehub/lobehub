import {
  CloudSandboxExecutionRuntime,
  CloudSandboxIdentifier,
} from '@lobechat/builtin-tool-cloud-sandbox';

import { FileService } from '@/server/services/file';
import { MarketService } from '@/server/services/market';
import { ServerSandboxService } from '@/server/services/sandbox';

import { type ServerRuntimeRegistration } from './types';

/**
 * CloudSandbox Server Runtime
 * Per-request runtime (needs topicId, userId)
 */
export const cloudSandboxRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    if (!context.userId || !context.topicId) {
      throw new Error('userId and topicId are required for Cloud Sandbox execution');
    }

    if (!context.serverDB) {
      throw new Error('serverDB is required for Cloud Sandbox execution');
    }

    const marketService = new MarketService({ userInfo: { userId: context.userId } });
    const fileService = new FileService(context.serverDB, context.userId);
    const sandboxService = new ServerSandboxService({
      fileService,
      marketService,
      topicId: context.topicId,
      userId: context.userId,
    });

    return new CloudSandboxExecutionRuntime(sandboxService);
  },
  identifier: CloudSandboxIdentifier,
};
