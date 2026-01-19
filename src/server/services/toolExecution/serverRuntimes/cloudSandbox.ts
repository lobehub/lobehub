import {
  CloudSandboxExecutionRuntime,
  CloudSandboxIdentifier,
} from '@lobechat/builtin-tool-cloud-sandbox';

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

    const sandboxService = new ServerSandboxService({
      accessToken: context.marketAccessToken,
      topicId: context.topicId,
      trustedClientToken: context.trustedClientToken,
      userId: context.userId,
    });

    return new CloudSandboxExecutionRuntime(sandboxService);
  },
  identifier: CloudSandboxIdentifier,
};
