import type {
  AgentRunClientLlmWait,
  AgentRunLlmExecutor,
  AgentRuntimeContext,
  AgentState,
} from '@lobechat/agent-runtime';
import { type ClientLlmWaitItem, type ResumeClientLlmWaitResult } from '@lobechat/types';
import debug from 'debug';
import pMap from 'p-map';

import type { MessageModel } from '@/database/models/message';
import { formatErrorForState } from '@/server/modules/AgentRuntime/formatErrorForState';
import {
  buildClientLlmWait,
  buildClientLlmWaitMessageError,
  CLIENT_WAIT_REVERT_RETRY_DELAYS_MS,
  isClientLlmWaitExpiryOf,
  MIN_CLIENT_LLM_WAIT_REMAINING_MS,
} from '@/server/modules/AgentRuntime/llmRelay/clientWait';
import {
  createClientLlmExecutorUnavailableError,
  getClientLlmWaitableReason,
} from '@/server/modules/AgentRuntime/llmRelay/errors';
import { CLIENT_LLM_WAIT_CAPABILITY } from '@/server/modules/AgentRuntime/llmRelay/protocol';

import { CLIENT_WAIT_ROW_WRITE_ATTEMPTS } from './constants';
import type { AgentRuntimeServiceContext } from './types';

const log = debug('lobe-server:agent-runtime-service');

/** What this module reads off the service. */
export type ClientLlmWaitDeps = Pick<
  AgentRuntimeServiceContext,
  | 'agentOperationModel'
  | 'baseURL'
  | 'completionLifecycle'
  | 'coordinator'
  | 'endExpiredClientLlmWait'
  | 'expireClientLlmWait'
  | 'finishClientLlmWaitExpiry'
  | 'messageModel'
  | 'queueService'
  | 'restoreClientLlmWait'
  | 'revertClientWaitResumeWithRetry'
  | 'traceRecorder'
  | 'updateAssistantRowWithRetry'
  | 'userId'
>;

/**
 * Park a step that failed because no client could run its LLM call — the
 * provider is reachable only from the user's device and no LobeHub client
 * took the call (a schedule, a bot, a CLI run, every tab closed). The run
 * waits in `waiting_for_client` on the state the step started from, its
 * assistant row says why, and an expiry check is armed. `undefined` when the
 * error is not one a client can fix, or nothing could resume or expire the
 * park (no queue) — the step then fails as before.
 */
export async function parkForClientLlm(
  deps: ClientLlmWaitDeps,
  operationId: string,
  errorState: AgentState,
  context: AgentRuntimeContext | undefined,
  notAfter?: string,
  stepStartState?: AgentState,
): Promise<AgentState | undefined> {
  const reason = getClientLlmWaitableReason(errorState.error);
  if (!reason || !deps.queueService) return;

  // A client that started the run but predates the wait takes the parked
  // call's error as the run's end and settles it locally, while the row
  // stays parked under its topic. Fail the step for it as before.
  const declaredExecutor = errorState.host?.llmExecutor;
  if (declaredExecutor && !declaredExecutor.capabilities?.includes(CLIENT_LLM_WAIT_CAPABILITY)) {
    log("[%s] The run's client cannot wait for a client, failing instead", operationId);
    return;
  }

  const errorBody = (errorState.error as { body?: { provider?: unknown } } | undefined)?.body;
  const provider =
    (typeof errorBody?.provider === 'string' && errorBody.provider) ||
    errorState.modelRuntimeConfig?.provider ||
    'unknown';

  const topicId = errorState.origin?.topicId;
  let assistantMessage: { id: string; parentId?: string | null } | undefined;
  if (topicId) {
    try {
      const row = await deps.messageModel.findLatestAssistantByOperationId({
        operationId,
        topicId,
      });
      if (row?.id) assistantMessage = { id: row.id, parentId: row.parentId };
    } catch (error) {
      log('[%s] Failed to find the parked call assistant row: %O', operationId, error);
    }
  }

  // A client picks a wait up by subscribing to the run's stream, which needs
  // the run's topic and assistant row. Without them nothing could claim the
  // wait, so fail the step as before instead of parking it.
  if (!topicId || !assistantMessage) {
    log('[%s] No stream anchor to park on, failing instead', operationId);
    return;
  }

  const wait = buildClientLlmWait({ assistantMessage, context, notAfter, provider, reason });
  // A re-park with (almost) nothing left of its wait would arm an expiry that
  // can land before this step commits and be overwritten by it. The wait is
  // over anyway: fail the step with its actionable error instead.
  if (Date.parse(wait.expiresAt) - Date.now() < MIN_CLIENT_LLM_WAIT_REMAINING_MS) {
    log('[%s] Client wait already used up, failing instead', operationId);
    return;
  }
  const parkedState: AgentState = {
    ...errorState,
    // The call never ran, so it does not spend a step: the resume replays it
    // through `runtime.step`, which counts it (and applies the step limit)
    // then. Keeping the incremented count would count it twice and, at the
    // limit, replay it as a forced final answer.
    ...(stepStartState && {
      forceFinish: stepStartState.forceFinish,
      stepCount: stepStartState.stepCount,
    }),
    clientLlmWait: wait,
    error: undefined,
    lastModified: wait.parkedAt,
    status: 'waiting_for_client',
  };

  // Resume, expiry and Stop all key off the durable row, so it must say
  // `waiting_for_client` before anything advertises the wait. If it cannot,
  // fail the step as before rather than park a run nothing could settle.
  try {
    const recorded = await deps.agentOperationModel.recordCompletion(operationId, {
      completionReason: 'waiting_for_client',
      status: 'waiting_for_client',
    });
    if (!recorded) {
      log('[%s] No durable row to park on, failing instead', operationId);
      return;
    }
  } catch (error) {
    log('[%s] Could not record the client wait, failing instead: %O', operationId, error);
    return;
  }

  // The expiry can fire at once (a re-park past its deadline), and it acts
  // only on the park it names: the parked state and the waiting notice must
  // already be in place, or it no-ops — or its terminal error is overwritten
  // by the notice — and the run waits with nothing left to end it.
  try {
    await deps.coordinator.saveAgentState(operationId, parkedState);
  } catch (error) {
    log('[%s] Could not save the parked state, failing instead: %O', operationId, error);
    return;
  }

  // The notice is the only thing a client that cannot run the provider sees
  // (its relay error handler re-reads the server-owned row), so a transient
  // failure is retried rather than left as a silent park.
  await deps.updateAssistantRowWithRetry(operationId, assistantMessage.id, {
    error: buildClientLlmWaitMessageError(wait),
  });

  try {
    await deps.queueService.scheduleMessage({
      context: undefined,
      delay: Math.max(Date.parse(wait.expiresAt) - Date.now(), 0),
      endpoint: `${deps.baseURL}/run`,
      operationId,
      payload: { clientLlmWaitExpired: wait.parkedAt },
      priority: 'normal',
      stepIndex: parkedState.stepCount,
    });
  } catch (error) {
    // Without the expiry the run could wait forever: fail it now instead
    // (the run's error then replaces the waiting notice on its row).
    log('[%s] Could not arm the client wait expiry, failing instead: %O', operationId, error);
    return;
  }

  log(
    '[%s] Parked in waiting_for_client (provider=%s, reason=%s, until %s)',
    operationId,
    provider,
    reason,
    wait.expiresAt,
  );
  return parkedState;
}

/**
 * Continue a run parked in `waiting_for_client` from the step it parked on.
 * The asking client becomes the run's relay executor, so the replayed call
 * is delivered to it. Single-fire: concurrent resumes (an automatic one and
 * a click) race on the durable row and one wins.
 */
export async function resumeFromClientLlmWait(
  deps: ClientLlmWaitDeps,
  params: {
    llmExecutor?: AgentRunLlmExecutor;
    operationId: string;
  },
): Promise<ResumeClientLlmWaitResult> {
  const { llmExecutor, operationId } = params;
  const state = await deps.coordinator.loadAgentState(operationId);
  if (!state || state.status !== 'waiting_for_client') return { resumed: false };
  if (state.origin?.userId && state.origin.userId !== deps.userId) return { resumed: false };

  // Past its deadline the wait is over even if the expiry is still in flight
  // (QStash can deliver late): leave the run to it rather than run the call
  // after the advertised time.
  const expiresAt = Date.parse(state.clientLlmWait?.expiresAt ?? '');
  if (Number.isFinite(expiresAt) && Date.now() >= expiresAt) return { resumed: false };

  const won = await deps.agentOperationModel.tryResumeFromClientWait(operationId);
  if (!won) return { resumed: false };

  const wait = state.clientLlmWait;
  // Past the claim, everything up to the queued step must land, or the run
  // goes back to its wait: a `running` row with nothing queued is one that no
  // resume, expiry or Stop can reach.
  try {
    await deps.coordinator.saveAgentState(operationId, {
      ...state,
      host: { ...state.host, ...(llmExecutor && { llmExecutor }) },
      lastModified: new Date().toISOString(),
    });

    // A Stop that landed after the claim could not settle the `running` row,
    // and the save above may have overwritten its `interrupted` state. It
    // marks the interrupt before saving, so any such Stop shows here; a later
    // one saves after this and the queued step stops on it.
    if (await deps.coordinator.isInterrupted(operationId)) {
      log('[%s] Stopped while being resumed; settling as interrupted', operationId);
      const interruptedState: AgentState = {
        ...state,
        clientLlmWait: undefined,
        lastModified: new Date().toISOString(),
        status: 'interrupted',
      };
      await deps.coordinator.saveAgentState(operationId, interruptedState);
      if (await deps.agentOperationModel.settleRunning(operationId, 'interrupted')) {
        await deps.completionLifecycle.dispatchHooks(operationId, interruptedState, 'interrupted');
      }
      return { resumed: false };
    }

    if (wait?.assistantMessageId) {
      try {
        await deps.messageModel.update(wait.assistantMessageId, { error: null });
      } catch (error) {
        log('[%s] Failed to clear the waiting notice: %O', operationId, error);
      }
    }

    await deps.queueService?.scheduleMessage({
      context: undefined,
      delay: 100,
      endpoint: `${deps.baseURL}/run`,
      operationId,
      payload: { resumeClientLlm: true },
      priority: 'high',
      stepIndex: state.stepCount,
    });
  } catch (error) {
    log('[%s] Could not hand the run to a client, staying parked: %O', operationId, error);
    await deps.restoreClientLlmWait(operationId, state);
    throw error;
  }

  log('[%s] Resumed from waiting_for_client at step %d', operationId, state.stepCount);
  return {
    assistantMessageId: wait?.assistantMessageId,
    resumed: true,
    topicId: state.origin?.topicId ?? undefined,
  };
}

/**
 * Put a run whose resume claim could not be completed back into its wait.
 * Other transitions may have raced the claim, so this re-reads the run
 * first. If a Stop moved it on (its settle could not match the claimed
 * `running` row), the row is settled to match instead of re-parked. If it is
 * still this park, the durable row goes back first — it is what resume,
 * expiry and Stop key off — and the expiry is re-armed, because one that
 * fired while the row read `running` gave up. Each step is best-effort so
 * one failure does not skip the rest.
 */
export async function restoreClientLlmWait(
  deps: ClientLlmWaitDeps,
  operationId: string,
  parkedState: AgentState,
) {
  const wait = parkedState.clientLlmWait;
  const current = await deps.coordinator.loadAgentState(operationId).catch(() => null);
  const stillParked =
    current?.status === 'waiting_for_client' && current.clientLlmWait?.parkedAt === wait?.parkedAt;

  if (!stillParked) {
    if (current?.status === 'interrupted') {
      const settled = await deps.agentOperationModel
        .settleRunning(operationId, 'interrupted')
        .catch(() => false);
      if (settled) {
        await deps.completionLifecycle
          .dispatchHooks(operationId, current, 'interrupted')
          .catch((error) => log('[%s] Failed to finish the stop: %O', operationId, error));
      }
    }
    return;
  }

  // The visible wait is only worth restoring once the row is parked again:
  // with the row stuck `running`, no resume, expiry or Stop can reach it, and
  // the abandoned-run watchdog is what settles it.
  if (!(await deps.revertClientWaitResumeWithRetry(operationId))) {
    log('[%s] Could not re-park the durable row; leaving it to the watchdog', operationId);
    return;
  }
  await deps.coordinator
    .saveAgentState(operationId, parkedState)
    .catch((error) => log('[%s] Failed to restore the parked state: %O', operationId, error));
  if (wait?.assistantMessageId) {
    await deps.messageModel
      .update(wait.assistantMessageId, { error: buildClientLlmWaitMessageError(wait) })
      .catch((error) => log('[%s] Failed to restore the waiting notice: %O', operationId, error));
  }
  if (!wait) return;

  // Duplicate expiries are no-ops (they match on `parkedAt` and the row CAS).
  if (Date.now() >= Date.parse(wait.expiresAt)) {
    await deps
      .expireClientLlmWait(operationId, wait.parkedAt)
      .catch((error) => log('[%s] Failed to expire the overdue wait: %O', operationId, error));
    return;
  }
  await deps.queueService
    ?.scheduleMessage({
      context: undefined,
      delay: Math.max(Date.parse(wait.expiresAt) - Date.now(), 0),
      endpoint: `${deps.baseURL}/run`,
      operationId,
      payload: { clientLlmWaitExpired: wait.parkedAt },
      priority: 'normal',
      stepIndex: parkedState.stepCount,
    })
    .catch((error) => log('[%s] Failed to re-arm the wait expiry: %O', operationId, error));
}

/** Put the claimed row back to `waiting_for_client`, riding out a transient DB error. */
export async function revertClientWaitResumeWithRetry(
  deps: ClientLlmWaitDeps,
  operationId: string,
): Promise<boolean> {
  for (const delayMs of CLIENT_WAIT_REVERT_RETRY_DELAYS_MS) {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    try {
      // `false` means the row is no longer the claimed `running` one, so it
      // is not ours to put back.
      return await deps.agentOperationModel.revertClientWaitResume(operationId);
    } catch (error) {
      log('[%s] Failed to re-park the durable row: %O', operationId, error);
    }
  }
  return false;
}

/**
 * Runs of this user parked in `waiting_for_client`, with what a client needs
 * to pick one up: the provider it must be able to run, and where the run's
 * conversation lives so it can subscribe to the stream before resuming.
 */
export async function listClientLlmWaits(
  deps: ClientLlmWaitDeps,
  providers?: string[],
): Promise<ClientLlmWaitItem[]> {
  const rows = await deps.agentOperationModel.listWaitingForClient({ providers });
  const items = await pMap(
    rows,
    async (row): Promise<ClientLlmWaitItem | undefined> => {
      const state = await deps.coordinator.loadAgentState(row.id).catch(() => null);
      const wait = state?.clientLlmWait;
      if (state?.status !== 'waiting_for_client' || !wait) return;
      return {
        agentId: state.origin?.agentId ?? undefined,
        assistantMessageId: wait.assistantMessageId,
        expiresAt: wait.expiresAt,
        operationId: row.id,
        provider: wait.provider,
        threadId: state.origin?.threadId ?? undefined,
        topicId: state.origin?.topicId ?? row.topicId ?? undefined,
      };
    },
    { concurrency: 4 },
  );
  return items.filter((item): item is ClientLlmWaitItem => !!item);
}

/**
 * End a `waiting_for_client` park nobody resumed in time. A no-op unless the
 * run is still parked on the very wait that armed this check; the durable
 * row CAS keeps a racing resume from being killed.
 */
export async function expireClientLlmWait(
  deps: ClientLlmWaitDeps,
  operationId: string,
  parkedAt: string,
): Promise<boolean> {
  const state = await deps.coordinator.loadAgentState(operationId);

  // A redelivery after this expiry already ended the run but its lifecycle
  // delivery threw (a critical hook asks QStash to retry): deliver it again,
  // like a retried terminal step does.
  if (state?.status === 'error' && isClientLlmWaitExpiryOf(state, parkedAt)) {
    log('[%s] Redelivering the lifecycle of an expired client wait', operationId);
    await deps.finishClientLlmWaitExpiry(operationId, state);
    return true;
  }

  if (state?.status !== 'waiting_for_client' || state.clientLlmWait?.parkedAt !== parkedAt) {
    return false;
  }

  // Redis still holds this exact park. A row this CAS cannot claim is one a
  // resume took (`running`), unless it is already `error`: then an earlier
  // delivery of this expiry settled it and failed before finishing (resumes,
  // Stop and failing steps all move the Redis state off this park first), so
  // finish it now — QStash retries the delivery that threw.
  const settled = await deps.agentOperationModel.settleClientWait(operationId);
  if (!settled) {
    const row = await deps.agentOperationModel.findById(operationId);
    if (row?.status !== 'error') return false;
    log('[%s] Finishing a client wait expiry that settled but did not finish', operationId);
  }

  await deps.endExpiredClientLlmWait(operationId, state, state.clientLlmWait);

  log('[%s] waiting_for_client expired (parked at %s)', operationId, parkedAt);
  return true;
}

/**
 * The terminal half of an expiry, once the durable row reads `error`: the
 * parked call's row, the Redis state (which ends the stream) and the
 * lifecycle. `state` is the run as it was parked on `wait`.
 */
export async function endExpiredClientLlmWait(
  deps: ClientLlmWaitDeps,
  operationId: string,
  state: AgentState,
  wait: AgentRunClientLlmWait,
) {
  const provider = wait.provider;
  const finalState: AgentState = {
    ...state,
    clientLlmWait: undefined,
    error: formatErrorForState(
      createClientLlmExecutorUnavailableError(provider, 'wait_timeout', {
        waitedSince: wait.parkedAt,
      }),
    ),
    lastModified: new Date().toISOString(),
    status: 'error',
  };

  // The row gets the terminal error first: the save below ends the stream
  // with a `uiMessages` snapshot read from the DB, and an open tab adopts it,
  // so writing it later would leave that tab on the waiting notice. The
  // lifecycle writes the same error again when it finalizes the run.
  // A transient failure is retried here: the lifecycle's later write emits
  // no message patch, so a tab that took the stale snapshot would keep the
  // dead waiting notice until reload.
  const assistantMessageId = wait.assistantMessageId;
  if (assistantMessageId && finalState.error) {
    const message = deps.completionLifecycle.extractErrorMessage(finalState.error);
    const error = { ...finalState.error, body: finalState.error.body ?? { message }, message };
    await deps.updateAssistantRowWithRetry(operationId, assistantMessageId, { error });
  }

  // Ends the stream (`agent_runtime_end`) and finalizes the run like any failure.
  await deps.coordinator.saveAgentState(operationId, finalState);
  await deps.completionLifecycle.emitSignalEvents(operationId, finalState, 'error');
  await deps.finishClientLlmWaitExpiry(operationId, finalState);
}

/**
 * Write a client-wait notice or error onto the assistant row, retrying a
 * transient failure: what a connected tab shows next is read from this row.
 */
export async function updateAssistantRowWithRetry(
  deps: ClientLlmWaitDeps,
  operationId: string,
  messageId: string,
  value: Parameters<MessageModel['update']>[1],
) {
  for (let attempt = 1; attempt <= CLIENT_WAIT_ROW_WRITE_ATTEMPTS; attempt += 1) {
    try {
      await deps.messageModel.update(messageId, value);
      return;
    } catch (error) {
      log('[%s] Failed to write the assistant row (%d): %O', operationId, attempt, error);
      if (attempt < CLIENT_WAIT_ROW_WRITE_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
      }
    }
  }
}

/** Lifecycle delivery of an expired client wait; safe to repeat on redelivery. */
export async function finishClientLlmWaitExpiry(
  deps: ClientLlmWaitDeps,
  operationId: string,
  finalState: AgentState,
) {
  const provider = (finalState.error as { body?: { provider?: string } } | undefined)?.body
    ?.provider;
  await deps.completionLifecycle.dispatchHooks(operationId, finalState, 'error');
  await deps.traceRecorder.finalize(operationId, {
    completionReason: 'error',
    error: {
      message: `No LobeHub client picked up the ${provider ?? 'local model'} call in time`,
      type: String(finalState.error?.type ?? 'ClientLlmExecutorUnavailable'),
    },
    state: finalState,
  });
}
