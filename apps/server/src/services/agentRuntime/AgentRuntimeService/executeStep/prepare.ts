import {
  type AgentRunClientLlmWait,
  type AgentRuntimeContext,
  type AgentState,
  findCurrentTurnPendingToolMessages,
} from '@lobechat/agent-runtime';
import { type ChatToolPayload } from '@lobechat/types';
import debug from 'debug';

import { isDeviceCapablePlan, isDeviceLockedPlan } from '@/helpers/executionTarget';
import { runMayUseDevice } from '@/server/modules/AgentRuntime/executors/resolveRunActiveDeviceId';
import { buildClientLlmWaitResumeContext } from '@/server/modules/AgentRuntime/llmRelay/clientWait';

import { type AgentExecutionParams } from '../../types';
import type { AgentRuntimeServiceContext } from '../types';

const log = debug('lobe-server:agent-runtime-service');

/**
 * Decision points after which the agent calls the LLM again: the tool (or
 * sub-agent) results of the turn are all in, so a user message can join here
 * without splitting an assistant's tool calls from their results.
 */
const LLM_NEXT_PHASES = new Set([
  'tool_result',
  'tools_batch_result',
  'sub_agent_result',
  'sub_agents_batch_result',
]);

/** What this module reads off the service. */
export type StepPrepareDeps = Pick<
  AgentRuntimeServiceContext,
  | 'computeDeviceContext'
  | 'humanIntervention'
  | 'injectQueuedFollowUp'
  | 'readQueuedMessagesFlag'
  | 'refreshMessagesFromDB'
  | 'resolveAsyncToolResumeParentMessageId'
>;

export interface PreparedStepInput {
  currentContext: AgentExecutionParams['context'];
  currentState: AgentState;
  /** Set when a parked supervisor finishes without another LLM turn. */
  forcedFinishState: AgentState | undefined;
  resumedClientLlmWait: AgentRunClientLlmWait | undefined;
}

/**
 * The state and context this step runs with: the human decision it carries,
 * an async-tool or client resume, a forced finish, the device binding and the
 * queued-follow-up flag.
 */
export async function prepareStepInput(
  deps: StepPrepareDeps,
  {
    agentState,
    deferredInitContext,
    params,
    stepEntryMessages,
  }: {
    agentState: AgentState;
    /** The context a deferred init assembled in this delivery, if one ran. */
    deferredInitContext?: AgentExecutionParams['context'];
    params: AgentExecutionParams;
    stepEntryMessages: Awaited<
      ReturnType<AgentRuntimeServiceContext['queryStepEntryMessages']>
    >['messages'];
  },
): Promise<PreparedStepInput> {
  const {
    approvedToolCall,
    context,
    finishAfterAsyncTool,
    humanInput,
    operationId,
    rejectAndContinue,
    rejectionReason,
    resumeAsyncTool,
    resumeClientLlm,
    stepIndex,
    toolMessageId,
  } = params;

  // Step 0 starts from the operation's saved initial context — the same rule
  // `executeSync` follows. For an ordinary run it is the context that was
  // queued; for a deferred init it is the one the init assembled, which the
  // queued placeholder predates, including on a redelivery after the save.
  const savedInitialContext = (
    agentState as AgentState & { initialContext?: AgentExecutionParams['context'] }
  ).initialContext;
  // Handle human intervention
  let currentContext =
    deferredInitContext ?? (stepIndex === 0 ? (savedInitialContext ?? context) : context);
  // The wait this step resumes, if any: a resumed call that finds no client
  // again re-parks under the same deadline, so retries never extend it.
  let resumedClientLlmWait: AgentRunClientLlmWait | undefined;
  let currentState = agentState;

  if (humanInput || approvedToolCall || rejectionReason) {
    const interventionResult = await deps.humanIntervention.process(currentState, {
      approvedToolCall,
      humanInput,
      rejectAndContinue,
      rejectionReason,
      toolMessageId,
    });
    currentState = interventionResult.newState;
    currentContext = interventionResult.nextContext;
  }

  // Resume from a parked async-tool wait (server sub-agent completion
  // bridge). Every deferred tool has delivered its result by now, so clear
  // the pending set, refresh messages from the DB (to pick up the tool
  // results written out-of-band), and re-enter the LLM with them.
  if (resumeAsyncTool && currentState.status === 'waiting_for_async_tool') {
    const refreshed = await deps.refreshMessagesFromDB(currentState);
    const pendingTools = (currentState.pendingToolsCalling ?? []) as ChatToolPayload[];
    const resumeParentMessageId = deps.resolveAsyncToolResumeParentMessageId(
      refreshed,
      pendingTools,
      currentState.pendingToolMessageIds,
    );
    currentState = structuredClone(currentState);
    currentState.messages = refreshed;
    currentState.pendingToolsCalling = [];
    currentState.pendingToolMessageIds = undefined;
    currentState.status = 'running';
    currentState.interruption = undefined;
    // Whatever ran while this operation was parked is invisible from
    // here: a sub-agent that saved a credential cleared its own snapshot,
    // not this one. Drop ours rather than render a list that predates it.
    currentState.operationCredentials = undefined;
    currentState.lastModified = new Date().toISOString();
    // A resume op (e.g. approving a callSubAgent) seeds its assistant
    // placeholder before running the tool; when that tool is deferred the
    // op parks with the seed unclaimed. Fill it now — creating another
    // assistant leaves the seed as an empty "…" sibling branch that hides
    // the real answer.
    const seededAssistantMessageId = currentState.pendingAssistantMessageId;
    currentContext = {
      payload: {
        ...(seededAssistantMessageId && { assistantMessageId: seededAssistantMessageId }),
        parentMessageId: resumeParentMessageId,
      },
      phase: 'user_input',
    } as AgentRuntimeContext;
    log(
      '[%s][%d] Resuming from async tool with %d messages (parent=%s)',
      operationId,
      stepIndex,
      refreshed.length,
      resumeParentMessageId,
    );
  }

  // Continue a run parked in `waiting_for_client`: a client that can run the
  // provider asked for it (`resumeFromClientLlmWait` already recorded it as
  // the run's executor). Replay the parked LLM turn into the assistant row
  // it created, on the messages the parked step had.
  if (resumeClientLlm && currentState.status === 'waiting_for_client') {
    const wait = currentState.clientLlmWait;
    resumedClientLlmWait = wait;
    currentState = structuredClone(currentState);
    currentState.status = 'running';
    currentState.clientLlmWait = undefined;
    currentState.error = undefined;
    currentState.lastModified = new Date().toISOString();
    if (wait?.assistantMessageId) currentState.pendingAssistantMessageId = wait.assistantMessageId;
    currentContext = buildClientLlmWaitResumeContext(wait);
    log(
      '[%s][%d] Resuming from waiting_for_client (assistant=%s)',
      operationId,
      stepIndex,
      wait?.assistantMessageId,
    );
  }

  // Finish a parked supervisor op WITHOUT another LLM turn (group
  // orchestration skipCallSupervisor / delegate). Refresh messages so the
  // final group conversation is captured, transition straight to `done`,
  // and let the standard `!shouldContinue` finalization below record
  // completion + dispatch hooks. Skips runtime.step entirely.
  let forcedFinishState: AgentState | undefined;
  if (finishAfterAsyncTool && currentState.status === 'waiting_for_async_tool') {
    const refreshed = await deps.refreshMessagesFromDB(currentState);
    currentState = structuredClone(currentState);
    currentState.messages = refreshed;
    currentState.pendingToolsCalling = [];
    currentState.pendingToolMessageIds = undefined;
    currentState.status = 'done';
    currentState.interruption = undefined;
    currentState.lastModified = new Date().toISOString();
    forcedFinishState = currentState;
    log(
      '[%s][%d] Finishing parked supervisor op after async tool (%d messages)',
      operationId,
      stepIndex,
      refreshed.length,
    );
  }

  // Pre-step computation: extract device context from DB messages
  // Follows front-end computeStepContext pattern — computed at step boundary, not inside executors
  // Only for a run that may actually touch a device: the executors read the
  // id through the same gate, so binding one here for a forbidden run buys
  // nothing and puts the device's working directory and system info into
  // the prompt variables (`serverCallLlmContextBuilder`).
  //
  // A run whose plan still leaves the device open (unrouted, not locked)
  // keeps the remote-device picker for its whole lifetime, so it must keep
  // following it: re-read on every step and let the latest activation win.
  // Binding only once made every later `activateDevice` report success
  // while local tools stayed on the first device.
  const executionPlan = currentState.plan?.execution;
  const deviceStillSelectable =
    !!executionPlan && isDeviceCapablePlan(executionPlan) && !isDeviceLockedPlan(executionPlan);
  if (
    (!currentState.binding?.device?.id || deviceStillSelectable) &&
    runMayUseDevice(currentState)
  ) {
    // Interventions and async resumes can change tool rows after the
    // entry snapshot. Those paths still need a fresh device read.
    const canReuseEntryMessages =
      !humanInput &&
      !approvedToolCall &&
      !rejectionReason &&
      !resumeAsyncTool &&
      !finishAfterAsyncTool;
    const deviceContext = await deps.computeDeviceContext(
      currentState,
      canReuseEntryMessages ? stepEntryMessages : undefined,
    );
    if (deviceContext && deviceContext.activeDeviceId !== currentState.binding?.device?.id) {
      currentState.binding = {
        ...currentState.binding,
        device: {
          id: deviceContext.activeDeviceId,
          platform: deviceContext.devicePlatform,
          systemInfo: deviceContext.deviceSystemInfo,
        },
      };
      log(
        '[%s][%d] Pre-step: device context computed from messages (deviceId: %s)',
        operationId,
        stepIndex,
        deviceContext.activeDeviceId,
      );
    }
  }

  // A follow-up the user queued behind this run joins it here, right before
  // the next LLM call, so the model reads it on its next step instead of after
  // the whole run. Re-entered like an async-tool resume: messages refreshed
  // from the DB (which now hold the steer message) and a `user_input` phase
  // anchored on it. Not while a tool of this turn still waits for approval —
  // the agent has to park for that first.
  if (
    currentContext &&
    !forcedFinishState &&
    LLM_NEXT_PHASES.has(currentContext.phase) &&
    findCurrentTurnPendingToolMessages(currentState.messages).length === 0
  ) {
    const injected = await deps.injectQueuedFollowUp(operationId, stepIndex, currentState);
    if (injected) {
      currentState = structuredClone(currentState);
      currentState.messages = await deps.refreshMessagesFromDB(currentState);
      currentState.lastModified = new Date().toISOString();
      currentContext = {
        ...currentContext,
        payload: { parentMessageId: injected.messageId },
        phase: 'user_input',
      } as AgentRuntimeContext;
    }
  }

  // Queued follow-ups that could not join (or arrived too late for this
  // decision point) live outside this state: in the client's composer,
  // which mirrors them into a flag, or in the server-side steer queue. The
  // agent reads either from the step context and hands the turn back at its
  // next decision point, so the follow-up starts as the next turn instead of
  // after the whole run.
  // This read is authoritative for the step: a value carried in on the
  // incoming context must not keep a hand-back the user has withdrawn.
  if (currentContext && !forcedFinishState) {
    const hasQueuedMessages = await deps.readQueuedMessagesFlag(
      operationId,
      stepIndex,
      currentState,
    );
    if (hasQueuedMessages !== Boolean(currentContext.stepContext?.hasQueuedMessages)) {
      const stepContext = { ...currentContext.stepContext };
      if (hasQueuedMessages) stepContext.hasQueuedMessages = true;
      else delete stepContext.hasQueuedMessages;
      currentContext = { ...currentContext, stepContext };
    }
  }

  return { currentContext, currentState, forcedFinishState, resumedClientLlmWait };
}
