import { CloudSandboxIdentifier, type ISandboxService } from '@lobechat/builtin-tool-cloud-sandbox';
import { CloudSandboxExecutionRuntime } from '@lobechat/builtin-tool-cloud-sandbox/executionRuntime';
import debug from 'debug';

import { UserModel } from '@/database/models/user';
import { FileService } from '@/server/services/file';
import { MarketService } from '@/server/services/market';
import { createSandboxService } from '@/server/services/sandbox';
import {
  isLhCommand,
  preprocessLhCommand,
  SHARE_VISITOR_LH_BLOCKED_MESSAGE,
} from '@/server/services/toolExecution/preprocessLhCommand';

import { resolveContentWorkspaceId } from './resolveWorkspaceScope';
import { type ServerRuntimeRegistration } from './types';

const log = debug('lobe-server:cloud-sandbox');

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
 *
 * `isShareVisitor` (set from `context.agentShareVisitor`, see the factory
 * below) disables the shim entirely: a share visitor's run executes under the
 * creator's identity, so the shim's `lh() { LOBEHUB_JWT=… }` prelude would
 * otherwise hand a JWT scoped to the CREATOR's own account into a shell the
 * VISITOR fully controls. `lobe-cloud-sandbox` is allowlisted for share
 * visitors specifically because this shim is skipped for them — see
 * `AGENT_SHARE_ALLOWED_BUILTIN_IDENTIFIERS` in `@lobechat/builtin-tools`.
 */
const withLhPreprocessing = (
  service: ISandboxService,
  resolve: {
    userId: string;
    /** Raw context workspace id, log-only — cheap to read, unlike {@link resolveContentWorkspaceId}. */
    workspaceIdHint: string | undefined;
    workspaceId: () => Promise<string | undefined>;
    isShareVisitor: boolean;
  },
): ISandboxService => ({
  // Delegated explicitly rather than spread: `createSandboxService` returns a
  // class instance, whose methods live on the prototype and would be dropped.
  callTool: async (toolName, params) => {
    const command = params?.command;
    if (!SHELL_TOOL_NAMES.has(toolName) || typeof command !== 'string') {
      return service.callTool(toolName, params);
    }

    // Fail closed BEFORE any workspace/JWT resolution: a share visitor never
    // gets the `lh` shim, so an `lh` invocation in their sandbox command
    // returns a plain error result the model can react to, instead of
    // silently falling through to `preprocessLhCommand` (which independently
    // refuses too — see its `shareVisitorBlocked` param — but this is the
    // primary, intended-to-be-load-bearing check).
    if (resolve.isShareVisitor && isLhCommand(command)) {
      // Deliberately no command content: it is visitor/model-controlled and
      // may carry an inline token — same as the `preprocessLhCommand` refusal.
      log(
        'Refused lh command for share visitor (user %s, workspace %s)',
        resolve.userId,
        resolve.workspaceIdHint,
      );
      return {
        error: {
          message: SHARE_VISITOR_LH_BLOCKED_MESSAGE,
          name: 'ShareVisitorBlocked',
        },
        result: null,
        success: false,
      };
    }

    const workspaceId = isLhCommand(command) ? await resolve.workspaceId() : undefined;
    const result = await preprocessLhCommand(
      command,
      resolve.userId,
      workspaceId,
      resolve.isShareVisitor,
    );

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
      userInfo: { userId: context.userId, workspaceId: context.workspaceId },
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
        isShareVisitor: Boolean(context.agentShareVisitor),
        userId: context.userId,
        workspaceId: () => (workspaceIdPromise ??= resolveContentWorkspaceId(context)),
        workspaceIdHint: context.workspaceId,
      }),
    );
  },
  identifier: CloudSandboxIdentifier,
};
