import type { AgentRunLlmExecutor, AgentState } from '@lobechat/agent-runtime';
import { AgentRuntime, findInMessages, GeneralChatAgent } from '@lobechat/agent-runtime';
import { DASHBOARD_DRY_RUN_AUDIT } from '@lobechat/builtin-tool-dashboard';
import { dynamicInterventionAudits } from '@lobechat/builtin-tools/dynamicInterventionAudits';
import { getModelPropertyWithFallback } from '@lobechat/model-runtime';
import { type UIChatMessage } from '@lobechat/types';
import { RequestTrigger } from '@lobechat/types';
import debug from 'debug';

import {
  createRuntimeExecutors,
  type RuntimeExecutorContext,
} from '@/server/modules/AgentRuntime/RuntimeExecutors';
import { LocalQueueServiceImpl } from '@/server/services/queue/impls';
import { createWidgetDryRunAudit } from '@/server/services/widget/dryRunAudit';
import { stateHasEntityFileEdits } from '@/server/services/workRegistration';

import { hookDispatcher } from '../hooks';
import type { AgentRuntimeService } from '.';
import { EVAL_TOOL_FORWARDING_HOOK_ID } from './constants';
import { createEvalToolForwardingHook } from './evalToolForwardingHook';

const log = debug('lobe-server:agent-runtime-service');

/**
 * Setup execution callback for LocalQueueServiceImpl
 * This breaks the circular dependency by using callback injection
 */
export function setupLocalExecutionCallback(svc: AgentRuntimeService): void {
  if (!svc.queueService) return;

  const impl = svc.queueService.getImpl();
  if (impl instanceof LocalQueueServiceImpl) {
    log('Setting up local execution callback');
    impl.setExecutionCallback(async (operationId, stepIndex, context, payload) => {
      // Mirror the QStash path where payload fields (approvedToolCall,
      // toolMessageId, resumeAsyncTool, …) ride the request body into
      // executeStep. Without this spread, local/in-memory resumes silently
      // lose their intervention/resume signal.
      await svc.executeStep({ context, operationId, stepIndex, ...payload });
    });
  }
}

/**
 * The relay executor a new run carries: the one its client declared, else
 * its parent's, so a child run (group member, `callSubAgent` / `callAgent`
 * sub-agent) on the same local model reaches the same device. No client
 * subscribes to the child's own channel — the gateway only hands
 * `llm_execute` to subscribers of the op it is sent on — so the inherited
 * executor names the channel its tab does listen on: the parent's, or the
 * one the parent already inherited. The parent stays subscribed meanwhile: it
 * is parked (`waiting_for_async_tool`) or supervising its members.
 * Only the caller's own parent in this workspace counts: a client can name
 * any `parentOperationId`, and a foreign run's executor would hand this
 * child's LLM payload to another user's tab, or to a tab of the same user
 * relaying with another workspace's providers.
 * Best-effort: an expired parent leaves the child without one.
 */
export async function resolveLlmExecutor(
  svc: AgentRuntimeService,
  declared: AgentRunLlmExecutor | undefined,
  parentOperationId: string | undefined,
): Promise<AgentRunLlmExecutor | undefined> {
  if (declared) return declared;
  if (!parentOperationId) return;

  let parent: AgentState | null | undefined;
  try {
    parent = await svc.coordinator.loadAgentState(parentOperationId);
  } catch (error) {
    log('[%s] Failed to read the parent relay executor: %O', parentOperationId, error);
    return;
  }
  if (
    parent?.origin?.userId !== svc.userId ||
    (parent.origin.workspaceId ?? undefined) !== (svc.workspaceId ?? undefined)
  )
    return;

  const inherited = parent.host?.llmExecutor;
  if (!inherited) return;

  return {
    ...inherited,
    channelOperationId: inherited.channelOperationId ?? parentOperationId,
  };
}

/**
 * The relay executor an operation carries, e.g. for an approval continuation
 * that the parked operation's client resumes. Best-effort: an unknown or
 * expired operation reads as none.
 */
export async function getLlmExecutor(
  svc: AgentRuntimeService,
  operationId: string,
): Promise<AgentRunLlmExecutor | undefined> {
  try {
    const state = await svc.coordinator.loadAgentState(operationId);
    return state?.host?.llmExecutor;
  } catch (error) {
    log('[%s] Failed to read the relay executor: %O', operationId, error);
    return;
  }
}

/**
 * Create Agent Runtime instance
 */
export async function createAgentRuntime(
  svc: AgentRuntimeService,
  {
    abortSignal,
    agentState,
    operationId,
    stepIndex,
    tracingContextEngine,
  }: {
    /** Cancels in-flight tool work when this step's operation is interrupted. */
    abortSignal?: AbortSignal;
    /**
     * Current runtime state, when the caller has it. Only consulted to decide
     * whether the early final-answer `visible_output_end` must be suppressed
     * (entity-file edits ⇒ completion still has to export + register file
     * Works, so loading should cover that window).
     */
    agentState?: any;
    operationId: string;
    stepIndex: number;
    tracingContextEngine?: (input: unknown, output: unknown, metadata?: unknown) => void;
  },
) {
  const state = agentState as AgentState | undefined;
  const modelRuntimeConfig = state?.modelRuntimeConfig;
  const contextWindowTokens =
    modelRuntimeConfig?.model && modelRuntimeConfig?.provider
      ? await getModelPropertyWithFallback<number | undefined>(
          modelRuntimeConfig.model,
          'contextWindowTokens',
          modelRuntimeConfig.provider,
        )
      : undefined;

  const world = state?.world;
  const origin = state?.origin;
  const plan = state?.plan;
  const principal = state?.principal;

  // Create Agent instance — use custom factory if provided, otherwise default to GeneralChatAgent
  const generalConfig = {
    agentConfig: world?.agent,
    compressionConfig: {
      enabled: world?.agent?.chatConfig?.enableContextCompression ?? true,
      maxWindowToken: contextWindowTokens ?? undefined,
    },
    dynamicInterventionAudits: {
      ...dynamicInterventionAudits,
      [DASHBOARD_DRY_RUN_AUDIT]: createWidgetDryRunAudit(
        svc.serverDB,
        origin?.userId ?? svc.userId,
        svc.workspaceId,
      ),
    },
    modelRuntimeConfig,
    operationId,
    userId: origin?.userId,
  };

  if (
    origin?.trigger === RequestTrigger.Eval &&
    plan?.eval?.toolForwarding &&
    !hookDispatcher.hasHook(operationId, EVAL_TOOL_FORWARDING_HOOK_ID)
  ) {
    hookDispatcher.register(operationId, [
      createEvalToolForwardingHook(plan.eval.toolForwarding, plan.eval.caseId),
    ]);
  }

  const agent = svc.agentFactory
    ? svc.agentFactory(generalConfig)
    : new GeneralChatAgent(generalConfig);

  // Create streaming executor context
  const executorContext: RuntimeExecutorContext = {
    abortSignal,
    // The factory may be a Graph-aware dispatcher that still returns the
    // default agent for ordinary conversations. Keep the early visible
    // output end behavior tied to the actual agent, not factory presence.
    //
    // Additionally suppressed once the run edited entity-format files:
    // completion still exports + registers them as `file` Works BEFORE the
    // terminal snapshot (see `CompletionLifecycle.registerFileWorks`), and
    // an early hint would end the visible loading seconds before that card
    // can exist. Deferring to the terminal `visible_output_end` lets loading
    // cover the export and the card land with `agent_runtime_end`.
    agentShareVisitor: principal?.actor?.shareVisitor,
    allowEarlyFinalAnswerVisibleOutputEnd:
      agent instanceof GeneralChatAgent && !stateHasEntityFileEdits(agentState),
    botContext: principal?.actor?.bot,
    execSubAgent: svc.delegate.execSubAgent,
    execVirtualSubAgent: svc.delegate.execVirtualSubAgent,
    execGroupMember: svc.delegate.execGroupMember,
    onGroupMemberResult: (params) => svc.completeGroupMemberBarrier(params),
    hookDispatcher,
    loadAgentState: svc.coordinator.loadAgentState.bind(svc.coordinator),
    messageModel: svc.messageModel,
    modelRuntimeConfig,
    operationId,
    serverDB: svc.serverDB,
    stepIndex,
    stream: plan?.stream,
    streamManager: svc.streamManager,
    toolExecutionService: svc.toolExecutionService,
    topicId: origin?.topicId,
    tracingContextEngine,
    userId: origin?.userId,
    workspaceId: svc.workspaceId,
  };

  // Create Agent Runtime instance
  const runtime = new AgentRuntime(agent as any, {
    executors: createRuntimeExecutors(executorContext),
  });

  return { agent, runtime };
}

/**
 * Compute device context from DB messages at step boundary.
 * Uses findInMessages visitor to scan tool messages for device activation.
 */
export async function computeDeviceContext(
  svc: AgentRuntimeService,
  state: any,
  entryMessages?: UIChatMessage[],
) {
  try {
    const dbMessages =
      entryMessages ??
      (await svc.messageModel.query(
        {
          agentId: state.origin?.agentId,
          // Group runs need groupId or the query returns no group messages
          // (standard branch filters `groupId IS NULL`), losing the device context.
          groupId: state.origin?.groupId,
          threadId: state.origin?.threadId,
          topicId: state.origin?.topicId,
        },
        { allowShareVisitor: true },
      ));

    return findInMessages(
      dbMessages,
      (msg) => {
        const activeDeviceId = msg.pluginState?.metadata?.activeDeviceId;
        if (activeDeviceId) {
          return {
            activeDeviceId,
            devicePlatform: msg.pluginState?.metadata?.devicePlatform as string | undefined,
            deviceSystemInfo: msg.pluginState?.metadata?.deviceSystemInfo as
              Record<string, string> | undefined,
          };
        }
      },
      { role: 'tool' },
    );
  } catch (error) {
    log('computeDeviceContext error: %O', error);
  }

  return undefined;
}
