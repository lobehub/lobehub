import type {
  BuiltinToolResult,
  DeleteDocumentWorkParams,
  DeleteTaskWorkParams,
  LobeBuiltinTool,
  PluginApiWorkAction,
  PluginApiWorkConfig,
  PluginApiWorkResourceType,
  RegisterDocumentWorkParams,
  RegisterSkillToolResultWorkParams,
  RegisterTaskWorkParams,
  WorkRegistrationIntent,
  WorkTaskTarget,
  WorkVersionChangeType,
  WorkVersionCumulativeUsage,
} from '@lobechat/types';

/**
 * Shared, dependency-light helpers for manifest-driven Work registration.
 *
 * The tool-execution dispatch layers (server `BuiltinToolsExecutor` and client
 * `invokeExecutor`) both consume these so the "what to register" logic lives in
 * exactly ONE place with ONE test suite. Each layer keeps its own "how to
 * register" wiring (server → `WorkModel`, client → `workService` + SWR
 * refreshes) because those are inherently side-of-the-wire specific.
 *
 * Kept free of the heavy `builtinTools` registry import (type-only deps) so it
 * can be pulled into either bundle cheaply — callers pass their own registry
 * reference into {@link getApiWorkConfig}.
 */

/**
 * A resolved document Work target extracted from a tool result's `state`.
 * Documents have no batch operation, so there is exactly one target per call.
 */
export interface DocumentWorkTarget {
  agentDocumentId?: string;
  agentId: string;
  documentId: string;
}

type WorkRegistrationIntentType = WorkRegistrationIntent['type'];
type WorkRegistrationIntentFor<Type extends WorkRegistrationIntentType> = Extract<
  WorkRegistrationIntent,
  { type: Type }
>;

interface WorkRegistrationResolveContext {
  apiName: string;
  config: PluginApiWorkConfig;
  payload: { args: unknown; result: Pick<BuiltinToolResult, 'state' | 'success'> };
}

interface WorkRegistrationAdapter<Type extends WorkRegistrationIntentType> {
  dispatch: (
    intent: WorkRegistrationIntentFor<Type>,
    ports: WorkRegistrationPorts,
    provenance: WorkRegistrationProvenance,
  ) => Promise<void>;
  resolve?: (
    context: WorkRegistrationResolveContext,
  ) => WorkRegistrationIntentFor<Type> | undefined;
}

type WorkRegistrationAdapterRegistry = {
  [Type in WorkRegistrationIntentType]: WorkRegistrationAdapter<Type>;
} & {
  [Type in PluginApiWorkResourceType]: WorkRegistrationAdapter<Type> & {
    resolve: NonNullable<WorkRegistrationAdapter<Type>['resolve']>;
  };
};

/**
 * Look up the declarative `work` config for a tool API from a builtin-tool
 * registry. Reads the static manifest (the `work` config is context-free, so
 * `resolveManifest` overrides never apply to it). Returns `undefined` when the
 * tool/API declares no Work.
 */
export const getApiWorkConfig = (
  tools: LobeBuiltinTool[],
  identifier: string,
  apiName: string,
): PluginApiWorkConfig | undefined =>
  tools
    .find((tool) => tool.identifier === identifier)
    ?.manifest.api.find((api) => api.name === apiName)?.work;

/**
 * Map a version-producing Work action onto the persisted version changeType. Only
 * `create` / `update` reach this — `delete` writes no version, so it is
 * deliberately excluded from the input type rather than silently mapped.
 */
export const workChangeTypeFromAction = (
  action: Exclude<PluginApiWorkAction, 'delete'>,
): WorkVersionChangeType => (action === 'create' ? 'created' : 'updated');

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** Read a non-empty string field off an optional untrusted record. */
const optionalStringFromRecord = (
  record: Record<string, unknown> | undefined,
  key: string,
): string | undefined => (record ? asString(record[key]) : undefined);

/** One task-identity candidate before success-filtering and identity mapping. */
interface TaskWorkTargetCandidate {
  identifier?: unknown;
  success?: unknown;
  taskId?: unknown;
}

/**
 * Extract the task identities to register from a `resourceType: 'task'` API
 * result. Works uniformly for server and client because both surface identity
 * the same way:
 *
 * - Batch (`createTasks`): `result.state.results[]`, each `{ identifier,
 *   success }`. Only the succeeded items are registered — a partially failed
 *   batch still registers its winners (top-level `success` is `false`, so this
 *   is gated per item, not on the whole result).
 * - Single create (`createTask`): `result.state.taskId` / `result.state.identifier`.
 * - Single update (`editTask` / `setTaskSchedule` / `setTaskVerify`): the
 *   `identifier` is a required manifest param, so it falls back to
 *   `args.identifier` when the server runtime returns no state.
 *
 * Single-target extraction is gated on `result.success` so a failed update
 * (whose `args.identifier` is still present) never registers a phantom version.
 */
export const extractTaskWorkTargets = ({
  args,
  result,
}: {
  args: unknown;
  result: Pick<BuiltinToolResult, 'state' | 'success'>;
}): WorkTaskTarget[] => {
  const stateRecord = isRecord(result.state) ? result.state : undefined;
  const argsRecord = isRecord(args) ? args : undefined;

  // Normalize both shapes into one candidate list, then run a single
  // success-filter → identity-map → drop-empty pipeline:
  // - Batch (`createTasks`): each `state.results[]` item, gated per item so a
  //   partially failed batch still registers its winners (top-level `success`
  //   is ignored here).
  // - Single (`createTask` / `editTask` / …): one synthetic item gated on the
  //   call's own `success`; the update identifier falls back to
  //   `args.identifier` when the server runtime returns no state.
  const candidates: unknown[] = Array.isArray(stateRecord?.results)
    ? stateRecord.results
    : result.success
      ? [
          {
            identifier:
              optionalStringFromRecord(stateRecord, 'identifier') ??
              optionalStringFromRecord(argsRecord, 'identifier'),
            success: true,
            taskId: stateRecord?.taskId,
          } satisfies TaskWorkTargetCandidate,
        ]
      : [];

  return candidates
    .filter(isRecord)
    .filter((item) => (item as TaskWorkTargetCandidate).success === true)
    .map((item) => ({
      taskId: asString((item as TaskWorkTargetCandidate).taskId),
      taskIdentifier: asString((item as TaskWorkTargetCandidate).identifier),
    }))
    .filter((target) => Boolean(target.taskId || target.taskIdentifier));
};

/**
 * Extract the single document identity to register from a `resourceType:
 * 'document'` API result. The document runtime stamps a uniform identity block
 * (`agentDocumentId` / `agentId` / `documentId`) into `state` for every mutating
 * API, so extraction is a flat read off `result.state`.
 *
 * Returns `undefined` unless the call SUCCEEDED and both `documentId` (the Work
 * resource identity — the backing `documents` row) and `agentId` (the agent
 * producing the version and validating the binding) are present.
 * `agentDocumentId` is optional metadata and does not gate registration.
 */
export const extractDocumentWorkTarget = ({
  result,
}: {
  result: Pick<BuiltinToolResult, 'state' | 'success'>;
}): DocumentWorkTarget | undefined => {
  if (!result.success) return undefined;

  const stateRecord = isRecord(result.state) ? result.state : undefined;
  const agentDocumentId = optionalStringFromRecord(stateRecord, 'agentDocumentId');
  const agentId = optionalStringFromRecord(stateRecord, 'agentId');
  const documentId = optionalStringFromRecord(stateRecord, 'documentId');

  if (!documentId || !agentId) return undefined;

  return { agentDocumentId, agentId, documentId };
};

const resolveTaskWorkIntent = ({
  config,
  payload,
}: WorkRegistrationResolveContext): WorkRegistrationIntentFor<'task'> | undefined => {
  const targets = extractTaskWorkTargets(payload);
  if (targets.length === 0) return undefined;

  // `delete` locates the Work by `state.taskId` (the task row is already gone),
  // so it reuses the same target extraction but writes no version changeType.
  if (config.action === 'delete') return { action: 'delete', targets, type: 'task' };

  return {
    action: config.action,
    changeType: workChangeTypeFromAction(config.action),
    targets,
    type: 'task',
  };
};

const resolveDocumentWorkIntent = ({
  apiName,
  config,
  payload,
}: WorkRegistrationResolveContext): WorkRegistrationIntentFor<'document'> | undefined => {
  const document = extractDocumentWorkTarget(payload);
  if (!document) return undefined;

  // `delete` locates the Work by `state.documentId` (the row is already gone),
  // so it reuses the same identity but writes no version changeType.
  if (config.action === 'delete') return { action: 'delete', document, type: 'document' };

  return {
    action: 'register',
    document: {
      ...document,
      changeType: workChangeTypeFromAction(config.action),
      // The concrete API name is the document Work's producing tool.
      toolName: apiName,
    },
    type: 'document',
  };
};

/**
 * Resolve the manifest-driven Work registration intent for a tool API call, or
 * `undefined` when nothing should be registered (no `work` config, an
 * unsupported `resourceType`, or no extractable targets).
 *
 * The type adapter emits the FINAL serializable intent directly. There is no
 * intermediate resolved-plan union or second type switch before the intent is
 * handed to the runtime.
 */
export const resolveWorkRegistration = (
  tools: LobeBuiltinTool[],
  identifier: string,
  apiName: string,
  payload: { args: unknown; result: Pick<BuiltinToolResult, 'state' | 'success'> },
): WorkRegistrationIntent | undefined => {
  const config = getApiWorkConfig(tools, identifier, apiName);
  if (!config) return undefined;

  const adapter = WORK_REGISTRATION_ADAPTERS[config.resourceType];
  return adapter.resolve({ apiName, config, payload });
};

/**
 * Side-of-the-wire persistence operations the dispatcher drives; the server
 * backs them with `WorkModel` methods, the client with `workService` methods.
 */
export interface WorkRegistrationPorts {
  /**
   * Optional: the client deliberately does NOT handle document deletes (they
   * stay a lambda-side effect of the `removeDocument` mutation — a deletion
   * carries no cost, so it needs no cost-stamping defer). Leaving the port
   * undefined makes the document-delete intent a no-op.
   */
  deleteDocumentWork?: (params: DeleteDocumentWorkParams) => Promise<unknown>;
  deleteTaskWork: (params: DeleteTaskWorkParams) => Promise<unknown>;
  handleSkillToolResult: (params: RegisterSkillToolResultWorkParams) => Promise<unknown>;
  registerDocument: (params: RegisterDocumentWorkParams) => Promise<unknown>;
  registerTask: (params: RegisterTaskWorkParams) => Promise<unknown>;
}

/**
 * Runtime-supplied provenance stamped onto every persisted Work version. The
 * cumulative cost/usage are stamped by the caller (not resolved here) because
 * they are known only AFTER the tool call's `accumulateTool` step has computed
 * the cumulative cost — see the wrapper JSDoc for why persistence is deferred
 * until then.
 */
export interface WorkRegistrationProvenance {
  agentId?: string | null;
  cumulativeCost?: number | null;
  cumulativeUsage?: WorkVersionCumulativeUsage | null;
  messageId?: string;
  rootOperationId?: string;
  threadId?: string | null;
  toolCallId?: string;
  /**
   * Tool/plugin identifier that produced this registration (the tool payload's
   * `identifier`). Skills stamp their own provider DB-side, so this is unused
   * for the skill branch.
   */
  toolIdentifier: string;
  /** Fallback concrete tool name for task Works; skills/documents carry their own. */
  toolName: string;
  topicId?: string;
}

/**
 * Log each rejected task-persistence result from a `Promise.allSettled` fan-out
 * without breaking sibling-tolerance. The index correlates a settled result back
 * to the target it was dispatched for (the two arrays are built in lockstep), so
 * a failure carries enough sanitized context (action, task id/identifier,
 * provenance ids, error) to be diagnosable — instead of silently vanishing.
 */
const logRejectedTaskWork = (
  action: 'delete' | 'create' | 'update',
  targets: WorkTaskTarget[],
  results: PromiseSettledResult<unknown>[],
  provenance: Pick<WorkRegistrationProvenance, 'rootOperationId' | 'toolCallId'>,
): void => {
  results.forEach((result, index) => {
    if (result.status !== 'rejected') return;
    const target = targets[index];

    console.error('[workRegistration] failed to persist task Work', {
      action,
      error: result.reason,
      rootOperationId: provenance.rootOperationId,
      toolCallId: provenance.toolCallId,
      taskId: target?.taskId,
      taskIdentifier: target?.taskIdentifier,
    });
  });
};

const dispatchTaskWorkIntent = async (
  intent: WorkRegistrationIntentFor<'task'>,
  ports: WorkRegistrationPorts,
  provenance: WorkRegistrationProvenance,
): Promise<void> => {
  const {
    agentId,
    cumulativeCost,
    cumulativeUsage,
    rootOperationId,
    messageId,
    threadId,
    toolCallId,
    toolIdentifier,
    toolName,
    topicId,
  } = provenance;
  const { action, changeType, targets } = intent;

  if (action === 'delete') {
    const deleteTargets = targets.filter((target) => target.taskId);
    const results = await Promise.allSettled(
      deleteTargets.map((target) => ports.deleteTaskWork({ taskId: target.taskId! })),
    );
    logRejectedTaskWork('delete', deleteTargets, results, { rootOperationId, toolCallId });
    return;
  }

  if (!changeType) return;

  const results = await Promise.allSettled(
    targets.map((target) =>
      ports.registerTask({
        agentId,
        changeType,
        cumulativeCost,
        cumulativeUsage,
        rootOperationId,
        messageId,
        taskId: target.taskId,
        taskIdentifier: target.taskIdentifier,
        threadId,
        toolCallId,
        toolIdentifier,
        toolName,
        topicId,
      }),
    ),
  );
  logRejectedTaskWork(action, targets, results, { rootOperationId, toolCallId });
};

const dispatchDocumentWorkIntent = async (
  intent: WorkRegistrationIntentFor<'document'>,
  ports: WorkRegistrationPorts,
  provenance: WorkRegistrationProvenance,
): Promise<void> => {
  if (intent.action === 'delete') {
    // No-op when the port is absent (client): document deletes stay a
    // lambda-side effect of the removeDocument mutation.
    await ports.deleteDocumentWork?.(intent.document);
    return;
  }

  const {
    agentId: provenanceAgentId,
    cumulativeCost,
    cumulativeUsage,
    rootOperationId,
    messageId,
    threadId,
    toolCallId,
    toolIdentifier,
    topicId,
  } = provenance;

  await ports.registerDocument({
    ...intent.document,
    agentId: provenanceAgentId ?? intent.document.agentId,
    cumulativeCost,
    cumulativeUsage,
    rootOperationId,
    messageId,
    threadId,
    toolCallId,
    toolIdentifier,
    topicId,
  });
};

const dispatchSkillWorkIntent = async (
  intent: WorkRegistrationIntentFor<'skill'>,
  ports: WorkRegistrationPorts,
  provenance: WorkRegistrationProvenance,
): Promise<void> => {
  const {
    agentId,
    cumulativeCost,
    cumulativeUsage,
    rootOperationId,
    messageId,
    threadId,
    toolCallId,
    topicId,
  } = provenance;

  // Skill providers (Linear / GitHub) normalize the untruncated payload into a Work.
  await ports.handleSkillToolResult({
    agentId,
    args: intent.args,
    cumulativeCost,
    cumulativeUsage,
    data: intent.data,
    provider: intent.provider,
    rootOperationId,
    messageId,
    threadId,
    toolCallId,
    toolName: intent.toolName,
    topicId,
  });
};

/**
 * Single extension point for Work registration types. Each adapter owns both
 * sides of the serializable intent boundary: builtin result resolution (when
 * applicable) and post-cost persistence. Adding a new intent type therefore
 * fails this exhaustive registry until its behavior is registered here.
 */
export const WORK_REGISTRATION_ADAPTERS = {
  document: {
    dispatch: dispatchDocumentWorkIntent,
    resolve: resolveDocumentWorkIntent,
  },
  skill: {
    dispatch: dispatchSkillWorkIntent,
  },
  task: {
    dispatch: dispatchTaskWorkIntent,
    resolve: resolveTaskWorkIntent,
  },
} satisfies WorkRegistrationAdapterRegistry;

/**
 * Dispatch a Work registration intent through the same adapter registry that
 * produced builtin intents. Consumed by BOTH persistence layers — the server runtime
 * (`registerWorkFromIntent`, backed by `WorkModel`) and the legacy client
 * runtime (`registerClientWorkFromIntent`, backed by `workService`). Each layer
 * only supplies its own {@link WorkRegistrationPorts} and per-call
 * {@link WorkRegistrationProvenance}; type-specific behavior lives in its adapter.
 *
 * Cost stamping happens in the wrappers, not here: the cumulative cost of a tool
 * call is known only after `accumulateTool` runs, so each wrapper computes
 * `cumulativeCost` / `cumulativeUsage` and passes them in via provenance. This
 * dispatcher stays dependency-light (type-only `@lobechat/types` imports) so it
 * can be pulled into either bundle cheaply.
 *
 * Multi-target fan-out uses `Promise.allSettled` so one target's failure never
 * kills its siblings. This function does NOT swallow errors at the top level —
 * the two wrappers keep their own try/catch + debug logging.
 */
export const dispatchWorkRegistrationIntent = async (
  intent: WorkRegistrationIntent,
  ports: WorkRegistrationPorts,
  provenance: WorkRegistrationProvenance,
): Promise<void> => {
  // TypeScript cannot retain the correlation between a union discriminant and
  // the matching mapped-registry value after indexed access. The registry key
  // comes directly from the same intent, so this type erasure is localized and
  // runtime-safe while every adapter remains strictly typed at declaration.
  const dispatch = WORK_REGISTRATION_ADAPTERS[intent.type].dispatch as (
    intent: WorkRegistrationIntent,
    ports: WorkRegistrationPorts,
    provenance: WorkRegistrationProvenance,
  ) => Promise<void>;

  await dispatch(intent, ports, provenance);
};
