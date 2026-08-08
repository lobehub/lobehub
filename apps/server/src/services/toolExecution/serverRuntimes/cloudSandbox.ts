import { CloudSandboxIdentifier, type ISandboxService } from '@lobechat/builtin-tool-cloud-sandbox';
import { CloudSandboxExecutionRuntime } from '@lobechat/builtin-tool-cloud-sandbox/executionRuntime';

import { UserModel } from '@/database/models/user';
import { FileService } from '@/server/services/file';
import { MarketService } from '@/server/services/market';
import { createSandboxService } from '@/server/services/sandbox';
import {
  isLhCommand,
  preprocessLhCommand,
} from '@/server/services/toolExecution/preprocessLhCommand';

import { resolveContentWorkspaceId } from './resolveWorkspaceScope';
import { type ServerRuntimeRegistration } from './types';

/** Sandbox tools whose `command` param can carry an `lh` invocation. */
const SHELL_TOOL_NAMES = new Set(['execScript', 'runCommand']);

/**
 * Wrap a sandbox service so shell tools get the same `lh` prelude as the skills
 * runtime and the client-side executor (`routers/tools/market.ts`).
 *
 * Without this the sandbox has no `lh` binary and no credentials at all, so a
 * model that reaches for the cloud-sandbox shell instead of the skills one —
 * both expose a `runCommand` and nothing tells the model they differ — gets a
 * bare `lh: not found` for a command the platform advertises.
 */
const withLhPreprocessing = (
  service: ISandboxService,
  resolve: {
    userId: string;
    workspaceId: () => Promise<string | undefined>;
  },
): ISandboxService => ({
  // Delegated explicitly rather than spread: `createSandboxService` returns a
  // class instance, whose methods live on the prototype and would be dropped.
  callTool: async (toolName, params) => {
    const command = params?.command;
    if (!SHELL_TOOL_NAMES.has(toolName) || typeof command !== 'string') {
      return service.callTool(toolName, params);
    }

    const workspaceId = isLhCommand(command) ? await resolve.workspaceId() : undefined;
    const result = await preprocessLhCommand(command, resolve.userId, workspaceId);

    if (result.error) {
      return {
        error: { message: result.error, name: 'AuthError' },
        result: null,
        success: false,
      };
    }

    return service.callTool(toolName, { ...params, command: result.command });
  },
  exportAndUploadFile: (path, filename, options) =>
    service.exportAndUploadFile(path, filename, options),
});

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

    let workspaceIdPromise: Promise<string | undefined> | undefined;

    return new CloudSandboxExecutionRuntime(
      withLhPreprocessing(sandboxService, {
        userId: context.userId,
        workspaceId: () => (workspaceIdPromise ??= resolveContentWorkspaceId(context)),
      }),
    );
  },
  identifier: CloudSandboxIdentifier,
};
