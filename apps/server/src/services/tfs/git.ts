import type { LobeChatDatabase } from '@lobechat/database';
import { parseTfsRepository, shortTfsBranch } from '@lobechat/utils/tfs';
import { TRPCError } from '@trpc/server';

import { TopicModel } from '@/database/models/topic';
import { UserModel } from '@/database/models/user';
import { assertCanUseTopicTargets } from '@/server/routers/lambda/_helpers/conversationResourceGuard';
import { assertCreatorTopicTargets } from '@/server/routers/lambda/_helpers/shareVisitorTargetGuard';
import { MarketService } from '@/server/services/market';
import { createSandboxService, resolveSandboxSessionConfig } from '@/server/services/sandbox';
import { normalizeSandboxCommandResult } from '@/server/services/sandbox/commandResult';

import { buildTfsGitCommand, type TfsGitOperation } from './gitCommand';

export interface TfsGitInput {
  branch?: string;
  operation: TfsGitOperation['operation'];
  sourceIndex: number;
  topicId: string;
}

/** A repository-bound network operation, never a credential lookup for the agent. */
export const runTfsGit = async (
  deps: {
    db: LobeChatDatabase;
    operationId?: string;
    userId: string;
    workspaceId?: string;
  },
  input: TfsGitInput,
) => {
  await assertCreatorTopicTargets(deps, [input.topicId]);
  await assertCanUseTopicTargets(deps, [input.topicId]);
  const topic = await new TopicModel(deps.db, deps.userId, deps.workspaceId).findById(
    input.topicId,
  );
  if (!topic || topic.senderId)
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Topic not found' });
  if (!topic.metadata?.sandboxEnvironmentId || topic.metadata.sandboxInstanceId)
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Select a TFS repository environment in the working directory selector.',
    });
  const sandbox = await resolveSandboxSessionConfig({
    isShareVisitorRun: false,
    serverDB: deps.db,
    topicId: input.topicId,
    userId: deps.userId,
    workspaceId: deps.workspaceId,
  });
  const init = sandbox.initialization;
  if (!init || init.authorizationError || !init.cloneCredential || !('tfs' in init.cloneCredential))
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message:
        'TFS authorization unavailable. Select an allowed environment, use a personal working directory and connect your personal TFS identity.',
    });
  if (sandbox.mode === 'drive' && sandbox.drive === 'public')
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'TFS operations require a personal working directory.',
    });
  const source = init.sources[input.sourceIndex];
  if (!source || !parseTfsRepository(source.url))
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Select a TFS source from the current environment.',
    });
  const branch = input.branch ?? shortTfsBranch(source.ref);
  if (!branch)
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Specify the target branch explicitly.' });
  const command = buildTfsGitCommand({
    branch,
    credentials: init.cloneCredential.tfs,
    operation: input.operation,
    path: source.path,
    url: source.url,
  });
  const settings = await new UserModel(deps.db, deps.userId).getUserSettings();
  const marketService = new MarketService({
    accessToken: settings?.market?.accessToken,
    userInfo: {
      sandboxOperation: deps.operationId
        ? { operationId: deps.operationId, topicId: input.topicId }
        : undefined,
      sandboxStorage: sandbox.claim,
      userId: deps.userId,
      workspaceId: deps.workspaceId,
    },
  });
  const service = createSandboxService({
    marketService,
    sandboxCwd: sandbox.cwd,
    sandboxInstanceId: sandbox.environment,
    sandboxMode: sandbox.mode,
    sandboxSpecification: sandbox.specification,
    sandboxWorkingDir: sandbox.workingDir,
    topicId: input.topicId,
    userId: deps.userId,
    // This operation requires an existing checkout; never run bootstrap with a network credential.
  });
  const secret = init.cloneCredential.tfs.secret;
  const scrub = (value: unknown): string =>
    typeof value === 'string' ? value.split(secret).join('[redacted]') : '';
  try {
    const result = await service.callTool('runCommand', { command, timeout: 120_000 });
    const commandResult = normalizeSandboxCommandResult(result);
    const success = commandResult.success && commandResult.exitCode === 0;
    return {
      success,
      exitCode: commandResult.exitCode,
      stdout: scrub(commandResult.output),
      stderr: result.success ? scrub(commandResult.stderr) : '',
      error: !success
        ? 'TFS Git operation failed. Check repository permissions and sandbox connectivity.'
        : undefined,
    };
  } catch {
    // Provider errors may contain their request; never forward the credential-bearing command.
    throw new TRPCError({
      code: 'BAD_GATEWAY',
      message: 'TFS Git operation failed. Check sandbox connectivity and repository permissions.',
    });
  }
};
