import { stripGoalCommand, withConversationGoalPrompt } from '@lobechat/builtin-tool-goal';
import { LOADING_FLAT } from '@lobechat/const';
import {
  appendAttachedFilesToPrompt,
  collectHeteroAttachedFiles,
  isLocalHeterogeneousType,
  resolveDispatchedClaudeCodeEntrypoint,
} from '@lobechat/heterogeneous-agents';
import {
  CHANNEL_INSTRUCTIONS,
  formatContextSelections,
  formatPageSelections,
} from '@lobechat/prompts';
import {
  applyTopicModelToHeterogeneousProvider,
  buildHeteroExecArgs,
  RequestTrigger,
} from '@lobechat/types';
import debug from 'debug';
import pMap from 'p-map';

import { signHeteroOperationJWT } from '@/libs/trpc/utils/internalJwt';
import { FileService } from '@/server/services/file';
import { HeterogeneousAgentService } from '@/server/services/heterogeneousAgent';
import type { ConversationHistoryEntry } from '@/server/services/heterogeneousAgent/cloudHeteroContext';
import { buildCloudHeteroContext } from '@/server/services/heterogeneousAgent/cloudHeteroContext';
import type { UnansweredUserTurn } from '@/server/services/heterogeneousAgent/unansweredUserTurns';
import { collectUnansweredUserTurns } from '@/server/services/heterogeneousAgent/unansweredUserTurns';
import { resolveSandboxSessionConfig } from '@/server/services/sandbox/session';

import { supportsCloudHeterogeneousSandbox } from '../../helpers/heteroErrors';
import type { ExecRunContext } from '../../types';
import { heteroOperationCapabilities } from '../heteroOperationCapabilities';
import { buildHeteroProjectContext } from '../projectContext';
import { traceHeteroStage } from '../sendTracing';
import { buildViewedTaskContextPrompt, joinSystemContext } from '../viewedTaskContext';
import type { HeteroDispatchDeps, HeteroDispatchInput } from './types';
import { settleInOrder } from './utils';

/** How many stored attachment keys are signed at once, per level. */
const SIGN_URL_CONCURRENCY = 5;

const log = debug('lobe-server:ai-agent-service');

/**
 * Everything a dispatch target needs that does not depend on where the run
 * goes: the resume session, the operation JWT, the topic and its repos, the
 * GitHub token, the recovery history, the cloud-sandbox placement, the system
 * contexts, and the CLI request itself.
 */
export const prepareHeteroRun = async (
  deps: HeteroDispatchDeps,
  ctx: Pick<
    ExecRunContext,
    | 'agentConfig'
    | 'appContext'
    | 'assistantMessageId'
    | 'prompt'
    | 'shareGate'
    | 'topicId'
    | 'userMessageId'
    | 'userMessageMetadata'
    | 'trigger'
  >,
  input: Pick<
    HeteroDispatchInput,
    | 'heterogeneousProvider'
    | 'heteroType'
    | 'operationTaskId'
    | 'pinnedHeterogeneousTopicModel'
    | 'runAttachments'
    | 'selfMessageIds'
    | 'reservedOperationId'
  >,
  operationId: string,
) => {
  const { agentConfig, appContext, assistantMessageId, prompt, topicId, userMessageMetadata } = ctx;
  const {
    heteroType,
    heterogeneousProvider,
    operationTaskId,
    pinnedHeterogeneousTopicModel,
    runAttachments,
    selfMessageIds,
  } = input;

  // Read resume session id for next-turn continuity.
  const heteroService = new HeterogeneousAgentService(deps.db, deps.userId, {
    workspaceId: deps.workspaceId,
  });
  const isChannelOperation = ctx.trigger === 'channel' && input.reservedOperationId === operationId;

  // Sign an operation-scoped JWT so the CLI can authenticate against
  // heteroIngest / heteroFinish without full user credentials.
  const signOperationJwt = async () => {
    try {
      return await signHeteroOperationJWT({
        // A run the user sent also gets `goal:manage` so it can create
        // the goal the agent supervises; the server still derives the agent and
        // topic from this operation, never from the CLI. A Task run also gets
        // `acceptance:evidence` for its own verification round.
        capabilities: heteroOperationCapabilities(prompt, {
          channel: isChannelOperation,
          taskId: operationTaskId,
          // A scheduled run replays the user's own message off history, so it has
          // no fresh user row; server-started `chat` deliveries have none either.
          userTurn:
            (ctx.trigger === RequestTrigger.Chat && !!ctx.userMessageId) ||
            ctx.trigger === RequestTrigger.Scheduled,
        }),
        operationId,
        userId: deps.userId,
        workspaceId: deps.workspaceId,
      });
    } catch (err) {
      log('execAgent: failed to sign operation JWT for hetero run: %O', err);
      throw new Error('Failed to sign operation JWT for hetero agent', { cause: err });
    }
  };

  // Resolve GitHub OAuth token for the sandbox. Always attempt so CC can use
  // git / gh CLI even when no repos are pre-selected. Falls back to the
  // standard 'github' key (LobeHub OAuth connector default); agent config can
  // override via GITHUB_CRED_KEY. Never rejects: a missing token is no token.
  const githubCredKey =
    agentConfig.agencyConfig?.heterogeneousProvider?.env?.GITHUB_CRED_KEY ?? 'github';
  const resolveGithubToken = async (): Promise<string | undefined> => {
    try {
      const marketService = await deps.getMarketService();
      // Inside a workspace, the GitHub cred must come from the workspace's shared
      // organization credentials, not the operator's personal creds.
      const credsAccessor = deps.workspaceId
        ? marketService.market.organizations.creds({ workspaceId: deps.workspaceId })
        : marketService.market.creds;
      const list = await credsAccessor.list();
      const cred = list.data?.find((c: { key: string }) => c.key === githubCredKey);
      if (!cred) return;
      const full = await credsAccessor.get(cred.id, { decrypt: true });
      const vals = (full as any).plaintext ?? (full as any).values ?? {};
      return vals.access_token ?? vals.token;
    } catch (err) {
      log('execAgent: failed to resolve GitHub token: %O', err);
    }
  };

  // Recovery history is reserved for the CLI's retry without native resume.
  // Amp threads are server-backed, so they rely on native continuation
  // exclusively and never need this local-file fallback. Never rejects.
  const loadRecentMessages = async () => {
    if (heteroType === 'amp') return;
    try {
      // `allowShareVisitor`: this is the RUN's own topic, already resolved
      // and authorized upstream. An agent-share visitor run executes under
      // the creator's identity, so without the opt-in `query()`'s
      // creator-facing default would hand the agent an empty history.
      return await deps.messageModel.query({ topicId, pageSize: 200 }, { allowShareVisitor: true });
    } catch (err) {
      log('execAgent: failed to load conversation history for hetero context: %O', err);
    }
  };

  // Every read below depends only on the request, so they start together
  // instead of one after another. The two best-effort reads (GitHub token,
  // history) never reject; the required ones are settled in their old order
  // so a failure surfaces the same error the sequential code threw. Nothing
  // here writes: the sandbox placement, which may create a drive folder,
  // waits until these required reads have succeeded, as before.
  const githubTokenPromise = traceHeteroStage('github_token', resolveGithubToken);
  const recentMessagesPromise = traceHeteroStage('history', loadRecentMessages);
  const [resumeSessionId, operationJwt, topic] = await settleInOrder([
    traceHeteroStage('resume_session', () =>
      heteroService.getHeterogeneousResumeSessionId(topicId),
    ),
    traceHeteroStage('sign_operation_jwt', signOperationJwt),
    // Read repos from topic metadata for sandbox setup (web/cloud only).
    traceHeteroStage('topic', () => deps.topicModel.findById(topicId)),
  ]);
  const topicRepos: string[] = topic?.metadata?.repos ?? [];

  // The primary resumed attempt already has native history and must not get
  // a serialized duplicate. A resumed session still needs the prompts of runs
  // stopped before the CLI recorded them; the history is withheld from it.
  const buildRecoveryHistory = async (): Promise<{
    conversationHistory?: ConversationHistoryEntry[];
    unansweredUserTurns?: UnansweredUserTurn[];
  }> => {
    const recentMsgs = await recentMessagesPromise;
    if (!recentMsgs) return {};
    // Assigned before the attachments are signed: a signing failure drops only
    // the unanswered turns, never the text history the resume fallback needs.
    let conversationHistory: ConversationHistoryEntry[] | undefined;
    try {
      const topicMsgs = recentMsgs.filter((m) => !m.threadId && !selfMessageIds.has(m.id));
      const turns = topicMsgs
        .filter(
          (m) =>
            (m.role === 'user' || m.role === 'assistant') &&
            m.content &&
            m.content !== LOADING_FLAT,
        )
        .slice(-30)
        .map((m) => ({
          content: m.content ?? '',
          role: m.role as 'assistant' | 'user',
        }));
      conversationHistory = turns.length > 0 ? turns : undefined;
      if (!resumeSessionId) return { conversationHistory };
      const unanswered = collectUnansweredUserTurns(topicMsgs, prompt);
      if (unanswered.length === 0) return { conversationHistory };
      // The query returns stored file keys; sign them like the current turn's attachments.
      const fileService = unanswered.some((turn) => turn.files.length > 0)
        ? new FileService(deps.db, deps.userId, deps.workspaceId)
        : undefined;
      // Both lists come from stored rows, so cap the URL signing they fan out into.
      const unansweredUserTurns = await pMap(
        unanswered,
        async (turn) => ({
          ...turn,
          files: await pMap(
            turn.files,
            async (file) => ({
              ...file,
              url: (await fileService?.getFullFileUrl(file.url)) || file.url,
            }),
            { concurrency: SIGN_URL_CONCURRENCY },
          ),
        }),
        { concurrency: SIGN_URL_CONCURRENCY },
      );
      return { conversationHistory, unansweredUserTurns };
    } catch (err) {
      log('execAgent: failed to load conversation history for hetero context: %O', err);
      return { conversationHistory };
    }
  };

  // Where a cloud-sandbox run keeps its files: the same resolution the plain
  // cloud-sandbox runtime does, so a hetero topic bound to an environment
  // instance runs in that instance rather than in a throwaway box. Only for
  // providers the cloud sandbox can host at all; device-only providers never
  // read it. Never throws — a failed lookup is the ephemeral sandbox.
  //
  // Primary context omits history (a failed native resume retries with the full
  // fallback). `/goal`, the task viewed in a Tasks side chat and the content the
  // user attached to this message ride along — the same selection context the
  // desktop's in-process run hands its CLI. These reads are independent of
  // each other and of the history, so they overlap too.
  const [
    githubToken,
    { conversationHistory, unansweredUserTurns },
    sandbox,
    [viewedTaskContext, projectContext],
  ] = await settleInOrder([
    githubTokenPromise,
    buildRecoveryHistory(),
    supportsCloudHeterogeneousSandbox(heteroType)
      ? traceHeteroStage('sandbox_session', () =>
          resolveSandboxSessionConfig({
            isShareVisitorRun: !!ctx.shareGate,
            serverDB: deps.db,
            topicId,
            userId: deps.userId,
            workspaceId: deps.workspaceId,
          }),
        )
      : Promise.resolve(undefined),
    traceHeteroStage('system_context', () =>
      Promise.all([
        buildViewedTaskContextPrompt(deps, appContext, operationTaskId),
        buildHeteroProjectContext(deps, appContext?.projectId, agentConfig.id),
      ]),
    ),
  ]);
  const sandboxPlacement = sandbox && { cwd: sandbox.cwd, mode: sandbox.mode };

  const providerContext = agentConfig.agencyConfig?.heterogeneousProvider?.systemContext;
  const contextSelections = userMessageMetadata?.contextSelections;
  const pageSelections = userMessageMetadata?.pageSelections;
  const selectionContext = contextSelections?.length
    ? formatContextSelections(contextSelections)
    : pageSelections?.length
      ? formatPageSelections(pageSelections)
      : undefined;
  const agentSystemContext = withConversationGoalPrompt(
    joinSystemContext(
      providerContext,
      projectContext,
      viewedTaskContext,
      selectionContext,
      isChannelOperation ? CHANNEL_INSTRUCTIONS : undefined,
    ),
    prompt,
  );
  const systemContext = buildCloudHeteroContext({
    agentSystemContext,
    conversationHistory: resumeSessionId ? undefined : conversationHistory,
    githubToken,
    repos: topicRepos,
    sandbox: sandboxPlacement,
    unansweredUserTurns,
  });
  const resumeFallbackSystemContext =
    resumeSessionId && conversationHistory
      ? buildCloudHeteroContext({
          agentSystemContext,
          conversationHistory,
          githubToken,
          repos: topicRepos,
          sandbox: sandboxPlacement,
        })
      : undefined;

  // Feed the resolved images (signed URLs) to the dispatched CLI for vision —
  // mirrors the local-mode path, where the client feeds the persisted
  // message's imageList into `sendPrompt`. Reuses the shared resolution above
  // so bot/IM and SPA gateway attachments are handled identically.
  const heteroImageList =
    runAttachments.imageList && runAttachments.imageList.length > 0
      ? runAttachments.imageList.map((image) => ({ id: image.id, url: image.url }))
      : undefined;
  const heteroExecArgs = isLocalHeterogeneousType(heteroType)
    ? buildHeteroExecArgs(
        heterogeneousProvider?.type === heteroType
          ? applyTopicModelToHeterogeneousProvider(
              heterogeneousProvider,
              pinnedHeterogeneousTopicModel,
            )
          : { type: heteroType },
      )
    : undefined;

  const heteroParams = {
    agentType: heteroType,
    assistantMessageId,
    // The one setting that travels from the agent's env to wherever the run
    // lands: forwarding the whole env would let an agent's author set arbitrary
    // variables on a member's device.
    claudeCodeEntrypoint:
      heteroType === 'claude-code' && heterogeneousProvider?.type === heteroType
        ? resolveDispatchedClaudeCodeEntrypoint(heterogeneousProvider.env)
        : undefined,
    githubToken,
    imageList: heteroImageList,
    jwt: operationJwt,
    operationId,
    // The CLI receives only the request: `/goal` is already in the system
    // context, and Claude Code's own `/goal` command would otherwise take it.
    // Non-image attachments have no content block a CLI accepts, so they ride
    // in the prompt as download links — otherwise the agent never sees them.
    prompt: appendAttachedFilesToPrompt(
      stripGoalCommand(prompt),
      collectHeteroAttachedFiles(runAttachments),
    ),
    repos: topicRepos,
    resumeFallbackSystemContext,
    resumeSessionId,
    systemContext,
    topicId,
    userId: deps.userId,
  };

  return {
    agentSystemContext,
    conversationHistory,
    heteroExecArgs,
    heteroParams,
    resumeSessionId,
    sandbox,
    topic,
    topicRepos,
    unansweredUserTurns,
  };
};

export type PreparedHeteroRun = Awaited<ReturnType<typeof prepareHeteroRun>>;
