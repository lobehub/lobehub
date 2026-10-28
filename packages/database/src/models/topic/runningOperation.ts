import type { AgentOperationStatus, ChatTopicMetadata } from '@lobechat/types';
import { and, eq } from 'drizzle-orm';

import { agentOperations, type TopicItem, topics } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import type { TopicModelContext } from './context';
import type {
  RunningOperation,
  RunningOperationPatch,
  SettleRunningOperationOptions,
} from './types';

/**
 * The device a topic runs on: the one its in-flight run was dispatched to,
 * else the one its turns are pinned to. The live dispatch wins because a run
 * does not always follow the pin — an `auto` target, an explicit request
 * device or a fixed workspace target can send it elsewhere. The `deviceId`
 * filter of `TopicModel.queryTopics` applies the same precedence in SQL.
 */
export const getTopicDeviceId = (
  metadata: Pick<ChatTopicMetadata, 'boundDeviceId' | 'runningOperation'> | null | undefined,
): string | undefined => metadata?.runningOperation?.deviceId ?? metadata?.boundDeviceId;

/**
 * How long an operation that still claims `running` / `idle` may hold the topic
 * against a background start before it is treated as abandoned.
 *
 * Only a backstop for the case the operation row cannot describe: a process
 * killed mid-run leaves its row at `running` forever, and every marker clear
 * site is best-effort (`ServerOperationStore.clearRunningMark` swallows
 * failures; the gateway client clears it from `onSessionComplete`, which never
 * runs if the tab closed). Runs parked on a human or an async tool are exempt —
 * those legitimately last days — so this only has to be longer than a plausible
 * uninterrupted generation. The real reaper remains the gateway watchdog's
 * `finalize-abandoned` call.
 */
export const ABANDONED_OPERATION_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Operation statuses that mean "this run is still the topic's owner". Parked
 * states are included on purpose: a run waiting for approval is not stuck.
 */
export const LIVE_OPERATION_STATUSES = new Set([
  'idle',
  'running',
  'waiting_for_human',
  'waiting_for_async_tool',
  'waiting_for_client',
]);

/** Parked states are exempt from the abandoned-age backstop — see above. */
export const UNBOUNDED_OPERATION_STATUSES = new Set([
  'waiting_for_human',
  'waiting_for_async_tool',
]);

/**
 * Operation statuses in which the server is still driving the run, so a
 * client-reported end must not clear its topic marker. `waiting_for_human` is
 * excluded on purpose: a run parked for approval is stream-terminal for the
 * client, which settles it to stop the spinner.
 */
export const CLIENT_UNSETTLEABLE_OPERATION_STATUSES = new Set<AgentOperationStatus>([
  'running',
  'waiting_for_async_tool',
  'waiting_for_client',
]);

/**
 * Atomically clear and settle the operation that still owns a topic.
 * A row lock keeps a stale terminal callback from clearing a newer operation
 * between the ownership check and update. Missing markers are intentionally
 * not settled because a client-side run can set `status = 'running'` without
 * an operation marker, so there is no proof that the terminal callback owns it.
 *
 * The result distinguishes a missing marker from a conflicting operation:
 * some legitimate hetero callbacks arrive after another terminal path has
 * already cleared their marker, while a callback that observes a newer
 * operation must stop before dispatching lifecycle hooks for the wrong run.
 */
export const settleRunningOperation = async (
  ctx: TopicModelContext,
  id: string,
  operationId: string,
  status: TopicItem['status'] = 'unread',
  options: SettleRunningOperationOptions = {},
) => {
  return ctx.db.transaction(async (tx) => {
    const [existing] = await tx
      .select({
        metadata: topics.metadata,
        projectId: topics.projectId,
        projectWorkingDirectoryId: topics.projectWorkingDirectoryId,
        status: topics.status,
      })
      .from(topics)
      .where(and(eq(topics.id, id), ctx.ownership()))
      .for('update');

    const runningOperation = existing?.metadata?.runningOperation;
    if (!runningOperation) {
      const currentMessage = existing?.metadata?.heteroCurrentMsgId;
      if (
        existing?.metadata?.lastSettledOperationId === operationId &&
        existing.status === 'unread' &&
        status === 'active'
      ) {
        await tx
          .update(topics)
          .set({ status: 'active', updatedAt: new Date() })
          .where(and(eq(topics.id, id), ctx.ownership()));

        return {
          assistantMessageId:
            currentMessage?.operationId === operationId ? currentMessage.msgId : undefined,
          status: 'corrected' as const,
        };
      }

      return {
        assistantMessageId:
          currentMessage?.operationId === operationId ? currentMessage.msgId : undefined,
        status: 'missing' as const,
      };
    }
    const isRoot = runningOperation.operationId === operationId;
    const operation = isRoot
      ? runningOperation
      : runningOperation.childOperations?.find((child) => child.operationId === operationId);
    if (!operation) {
      return { activeOperationId: runningOperation.operationId, status: 'conflict' as const };
    }

    // A client only learns a run ended from a stream event, and a mirrored or
    // early event can arrive while the server is still driving the run (e.g. a
    // supervisor parked on `waiting_for_async_tool` for its group members).
    // Clearing the marker then drops the run's topic reservation, so the next
    // member start fails as "Topic … remained busy". The server's own
    // `finish` clears the marker before it publishes the terminal event, so a
    // genuine end never reaches this check with the marker still in place.
    if (options.rejectInFlightOperation) {
      const [operationRow] = await tx
        .select({ status: agentOperations.status })
        .from(agentOperations)
        .where(eq(agentOperations.id, operationId))
        .limit(1);
      if (
        operationRow &&
        CLIENT_UNSETTLEABLE_OPERATION_STATUSES.has(operationRow.status as AgentOperationStatus)
      ) {
        return {
          activeOperationId: runningOperation.operationId,
          operationStatus: operationRow.status as AgentOperationStatus,
          status: 'in_flight' as const,
        };
      }
    }

    const metadata = {
      ...existing.metadata,
      ...(isRoot ? { lastSettledOperationId: operationId } : {}),
      runningOperation: isRoot
        ? null
        : {
            ...runningOperation,
            childOperations: runningOperation.childOperations?.filter(
              (child) => child.operationId !== operationId,
            ),
          },
    } as ChatTopicMetadata;

    await tx
      .update(topics)
      .set({
        metadata,
        ...(isRoot && existing.status === 'running' ? { status } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(topics.id, id), ctx.ownership()));

    const currentMessage = existing.metadata?.heteroCurrentMsgId;
    return {
      assistantMessageId:
        currentMessage?.operationId === operationId
          ? currentMessage.msgId
          : operation.assistantMessageId,
      hooks: operation.hooks,
      orchestrationRole: operation.orchestrationRole,
      status: 'settled' as const,
      threadId: operation.threadId ?? undefined,
    };
  });
};

export const appendRunningOperationChild = async (
  ctx: TopicModelContext,
  id: string,
  parentOperationId: string,
  child: RunningOperation,
): Promise<boolean> =>
  ctx.db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ metadata: topics.metadata })
      .from(topics)
      .where(and(eq(topics.id, id), ctx.ownership()))
      .for('update');
    const runningOperation = existing?.metadata?.runningOperation;
    if (!existing || runningOperation?.operationId !== parentOperationId) return false;

    await tx
      .update(topics)
      .set({
        metadata: {
          ...existing.metadata,
          runningOperation: {
            ...runningOperation,
            childOperations: [
              ...(runningOperation.childOperations ?? []).filter(
                (operation) => operation.operationId !== child.operationId,
              ),
              child,
            ],
          },
        },
      })
      .where(and(eq(topics.id, id), ctx.ownership()));
    return true;
  });

export const patchRunningOperation = async (
  ctx: TopicModelContext,
  id: string,
  operationId: string,
  patch: RunningOperationPatch,
): Promise<boolean> =>
  ctx.db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ metadata: topics.metadata })
      .from(topics)
      .where(and(eq(topics.id, id), ctx.ownership()))
      .for('update');
    const runningOperation = existing?.metadata?.runningOperation;
    if (!existing || !runningOperation) return false;

    let nextRunningOperation: RunningOperation;
    if (runningOperation.operationId === operationId) {
      nextRunningOperation = { ...runningOperation, ...patch };
    } else {
      let matched = false;
      const childOperations = runningOperation.childOperations?.map((child) => {
        if (child.operationId !== operationId) return child;
        matched = true;
        return { ...child, ...patch };
      });
      if (!matched) return false;
      nextRunningOperation = { ...runningOperation, childOperations };
    }

    await tx
      .update(topics)
      .set({
        metadata: { ...existing.metadata, runningOperation: nextRunningOperation },
      })
      .where(and(eq(topics.id, id), ctx.ownership()));
    return true;
  });

export const removeRunningOperationChild = async (
  ctx: TopicModelContext,
  id: string,
  operationId: string,
): Promise<boolean> =>
  ctx.db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ metadata: topics.metadata })
      .from(topics)
      .where(and(eq(topics.id, id), ctx.ownership()))
      .for('update');
    const runningOperation = existing?.metadata?.runningOperation;
    if (!existing || !runningOperation?.childOperations) return false;
    await tx
      .update(topics)
      .set({
        metadata: {
          ...existing.metadata,
          runningOperation: {
            ...runningOperation,
            childOperations: runningOperation.childOperations.filter(
              (child) => child.operationId !== operationId,
            ),
          },
        },
      })
      .where(and(eq(topics.id, id), ctx.ownership()));
    return true;
  });

export const updateRunningOperationAssistantMessage = async (
  ctx: TopicModelContext,
  id: string,
  operationId: string,
  assistantMessageId: string,
): Promise<boolean> =>
  ctx.db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ metadata: topics.metadata })
      .from(topics)
      .where(and(eq(topics.id, id), ctx.ownership()))
      .for('update');
    const runningOperation = existing?.metadata?.runningOperation;
    if (!existing || !runningOperation) return false;

    if (runningOperation.operationId === operationId) {
      await tx
        .update(topics)
        .set({
          metadata: {
            ...existing.metadata,
            heteroCurrentMsgId: { msgId: assistantMessageId, operationId },
            runningOperation: { ...runningOperation, assistantMessageId },
          },
        })
        .where(and(eq(topics.id, id), ctx.ownership()));
      return true;
    }

    const childOperations = runningOperation.childOperations?.map((child) =>
      child.operationId === operationId ? { ...child, assistantMessageId } : child,
    );
    if (!childOperations?.some((child) => child.operationId === operationId)) return false;

    await tx
      .update(topics)
      .set({
        metadata: {
          ...existing.metadata,
          heteroCurrentMsgId: { msgId: assistantMessageId, operationId },
          runningOperation: { ...runningOperation, childOperations },
        },
      })
      .where(and(eq(topics.id, id), ctx.ownership()));
    return true;
  });

export const takeRunningOperation = async (
  ctx: TopicModelContext,
  id: string,
  operationId: string,
): Promise<
  | {
      isRoot: boolean;
      operation: NonNullable<ChatTopicMetadata['runningOperation']>;
    }
  | undefined
> =>
  ctx.db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ metadata: topics.metadata })
      .from(topics)
      .where(and(eq(topics.id, id), ctx.ownership()))
      .for('update');
    const runningOperation = existing?.metadata?.runningOperation;
    if (!existing || !runningOperation) return undefined;

    if (runningOperation.operationId === operationId) {
      await tx
        .update(topics)
        .set({
          metadata: { ...existing.metadata, runningOperation: null },
        })
        .where(and(eq(topics.id, id), ctx.ownership()));
      return { isRoot: true, operation: runningOperation };
    }

    const child = runningOperation.childOperations?.find(
      (candidate) => candidate.operationId === operationId,
    );
    if (!child) return undefined;

    await tx
      .update(topics)
      .set({
        metadata: {
          ...existing.metadata,
          runningOperation: {
            ...runningOperation,
            childOperations: runningOperation.childOperations?.filter(
              (candidate) => candidate.operationId !== operationId,
            ),
          },
        },
      })
      .where(and(eq(topics.id, id), ctx.ownership()));
    return { isRoot: false, operation: child };
  });

/**
 * Whether the run a `runningOperation` marker points at is still the topic's
 * legitimate owner.
 *
 * Public so the gateway-token refresh routers can refuse to reconnect a
 * client to a marker whose run has already ended (the marker is cleared
 * best-effort, so a stale one must not be taken at face value).
 *
 * The marker itself cannot answer this — it carries no heartbeat and is
 * cleared best-effort — so the authority is the operation row, which both the
 * in-process runtime (`createOperation`) and the heterogeneous path
 * (`CompletionLifecycle.recordStart`) write before publishing the marker.
 *
 * Falls back to the marker's own `startedAt` only when no row exists: hetero's
 * `recordStart` is deliberately non-fatal, so a DB hiccup can leave a live run
 * with a marker and no row. A marker with neither a row nor a stamp cannot be
 * proven live and must not keep an already-stuck topic stuck.
 */
export const isRunningOperationAlive = async (
  ctx: TopicModelContext,
  tx: Pick<LobeChatDatabase, 'select'>,
  runningOperation: NonNullable<ChatTopicMetadata['runningOperation']>,
): Promise<boolean> => {
  const [operation] = await tx
    .select({ createdAt: agentOperations.createdAt, status: agentOperations.status })
    .from(agentOperations)
    .where(eq(agentOperations.id, runningOperation.operationId))
    .limit(1);

  if (!operation) {
    const markerStartedAt = runningOperation.startedAt
      ? Date.parse(runningOperation.startedAt)
      : Number.NaN;
    return (
      Number.isFinite(markerStartedAt) && Date.now() - markerStartedAt < ABANDONED_OPERATION_TTL_MS
    );
  }

  if (!LIVE_OPERATION_STATUSES.has(operation.status)) return false;
  if (UNBOUNDED_OPERATION_STATUSES.has(operation.status)) return true;

  // Claims `running`/`idle`, but a killed process never writes a terminal
  // status — age it out so the topic is not held forever.
  /* v8 ignore start -- unreachable: the `Number.NaN` arm; agent_operations.created_at is NOT NULL DEFAULT now() */
  const startedAt = operation.createdAt ? new Date(operation.createdAt).getTime() : Number.NaN;
  /* v8 ignore stop */
  return !Number.isFinite(startedAt) || Date.now() - startedAt < ABANDONED_OPERATION_TTL_MS;
};
