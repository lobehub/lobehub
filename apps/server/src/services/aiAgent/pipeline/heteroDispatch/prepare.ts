import { stripGoalCommand, withConversationGoalPrompt } from '@lobechat/builtin-tool-goal';
import { LOADING_FLAT } from '@lobechat/const';
import {
  appendAttachedFilesToPrompt,
  collectHeteroAttachedFiles,
  isLocalHeterogeneousType,
} from '@lobechat/heterogeneous-agents';
import { formatContextSelections, formatPageSelections } from '@lobechat/prompts';
import { applyTopicModelToHeterogeneousProvider, buildHeteroExecArgs } from '@lobechat/types';
import debug from 'debug';

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
import { buildViewedTaskContextPrompt, joinSystemContext } from '../viewedTaskContext';
import type { HeteroDispatchDeps, HeteroDispatchInput } from './types';

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
    | 'userMessageMetadata'
  >,
  input: Pick<
    HeteroDispatchInput,
    | 'heterogeneousProvider'
    | 'heteroType'
    | 'operationTaskId'
    | 'pinnedHeterogeneousTopicModel'
    | 'runAttachments'
    | 'selfMessageIds'
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
  const resumeSessionId = await heteroService.getHeterogeneousResumeSessionId(topicId);
  // Sign an operation-scoped JWT so the CLI can authenticate against
  // heteroIngest / heteroFinish without full user credentials.
  let operationJwt: string;
  try {
    operationJwt = await signHeteroOperationJWT({
      // A `/goal` run also gets `goal:manage` so it can create the goal the agent
      // supervises; the server still derives the agent and topic from this
      // operation, never from the CLI. A Task run also gets `acceptance:evidence`
      // for its own verification round.
      capabilities: heteroOperationCapabilities(prompt, { taskId: operationTaskId }),
      operationId,
      userId: deps.userId,
      workspaceId: deps.workspaceId,
    });
  } catch (err) {
    log('execAgent: failed to sign operation JWT for hetero run: %O', err);
    throw new Error('Failed to sign operation JWT for hetero agent', { cause: err });
  }

  // Read repos from topic metadata for sandbox setup (web/cloud only).
  const topic = await deps.topicModel.findById(topicId);
  const topicRepos: string[] = topic?.metadata?.repos ?? [];

  // Resolve GitHub OAuth token for the sandbox. Always attempt so CC can use
  // git / gh CLI even when no repos are pre-selected. Falls back to the
  // standard 'github' key (LobeHub OAuth connector default); agent config can
  // override via GITHUB_CRED_KEY.
  let githubToken: string | undefined;
  const githubCredKey =
    agentConfig.agencyConfig?.heterogeneousProvider?.env?.GITHUB_CRED_KEY ?? 'github';
  try {
    const marketService = await deps.getMarketService();
    // Inside a workspace, the GitHub cred must come from the workspace's shared
    // organization credentials, not the operator's personal creds.
    const credsAccessor = deps.workspaceId
      ? marketService.market.organizations.creds({ workspaceId: deps.workspaceId })
      : marketService.market.creds;
    const list = await credsAccessor.list();
    const cred = list.data?.find((c: { key: string }) => c.key === githubCredKey);
    if (cred) {
      const full = await credsAccessor.get(cred.id, { decrypt: true });
      const vals = (full as any).plaintext ?? (full as any).values ?? {};
      githubToken = vals.access_token ?? vals.token;
    }
  } catch (err) {
    log('execAgent: failed to resolve GitHub token: %O', err);
  }

  // Recovery history is reserved for the CLI's retry without native resume.
  // The primary resumed attempt already has native history and must not get
  // a serialized duplicate. Amp threads are server-backed, so they rely on
  // native continuation exclusively and never need this local-file fallback.
  let conversationHistory: ConversationHistoryEntry[] | undefined;
  // A resumed session still needs the prompts of runs stopped before the CLI
  // recorded them; the history above is withheld from it.
  let unansweredUserTurns: UnansweredUserTurn[] | undefined;
  if (heteroType !== 'amp') {
    try {
      // `allowShareVisitor`: this is the RUN's own topic, already resolved
      // and authorized upstream. An agent-share visitor run executes under
      // the creator's identity, so without the opt-in `query()`'s
      // creator-facing default would hand the agent an empty history.
      const recentMsgs = await deps.messageModel.query(
        { topicId, pageSize: 200 },
        { allowShareVisitor: true },
      );
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
      if (turns.length > 0) conversationHistory = turns;
      if (resumeSessionId) {
        const unanswered = collectUnansweredUserTurns(topicMsgs, prompt);
        if (unanswered.length > 0) {
          // The query returns stored file keys; sign them like the current turn's attachments.
          const fileService = unanswered.some((turn) => turn.files.length > 0)
            ? new FileService(deps.db, deps.userId, deps.workspaceId)
            : undefined;
          unansweredUserTurns = await Promise.all(
            unanswered.map(async (turn) => ({
              ...turn,
              files: await Promise.all(
                turn.files.map(async (file) => ({
                  ...file,
                  url: (await fileService?.getFullFileUrl(file.url)) || file.url,
                })),
              ),
            })),
          );
        }
      }
    } catch (err) {
      log('execAgent: failed to load conversation history for hetero context: %O', err);
    }
  }

  // Where a cloud-sandbox run keeps its files: the same resolution the plain
  // cloud-sandbox runtime does, so a hetero topic bound to an environment
  // instance runs in that instance rather than in a throwaway box. Only for
  // providers the cloud sandbox can host at all; device-only providers never
  // read it. Never throws — a failed lookup is the ephemeral sandbox.
  const sandbox = supportsCloudHeterogeneousSandbox(heteroType)
    ? await resolveSandboxSessionConfig({
        isShareVisitorRun: !!ctx.shareGate,
        serverDB: deps.db,
        topicId,
        userId: deps.userId,
        workspaceId: deps.workspaceId,
      })
    : undefined;
  const sandboxPlacement = sandbox && { cwd: sandbox.cwd, mode: sandbox.mode };

  // Primary context omits history (a failed native resume retries with the full
  // fallback). `/goal`, the task viewed in a Tasks side chat and the content the
  // user attached to this message ride along — the same selection context the
  // desktop's in-process run hands its CLI.
  const providerContext = agentConfig.agencyConfig?.heterogeneousProvider?.systemContext;
  const [viewedTaskContext, projectContext] = await Promise.all([
    buildViewedTaskContextPrompt(deps, appContext, operationTaskId),
    buildHeteroProjectContext(deps, appContext?.projectId, agentConfig.id),
  ]);
  const contextSelections = userMessageMetadata?.contextSelections;
  const pageSelections = userMessageMetadata?.pageSelections;
  const selectionContext = contextSelections?.length
    ? formatContextSelections(contextSelections)
    : pageSelections?.length
      ? formatPageSelections(pageSelections)
      : undefined;
  const agentSystemContext = withConversationGoalPrompt(
    joinSystemContext(providerContext, projectContext, viewedTaskContext, selectionContext),
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
