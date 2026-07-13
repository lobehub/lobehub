import type {
  BuiltinToolResult,
  DeleteDocumentWorkParams,
  DeleteTaskWorkParams,
  LobeBuiltinTool,
  PluginApiWorkAction,
  PluginApiWorkConfig,
  RegisterDocumentWorkParams,
  RegisterSkillToolResultWorkParams,
  RegisterTaskWorkParams,
  WorkRegistrationIntent,
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

/** A resolved task Work target extracted from a tool result / args. */
export interface TaskWorkTarget {
  taskId?: string;
  taskIdentifier?: string;
}

/**
 * A resolved Work registration plan. Discriminated by `action` so each dispatch
 * layer branches "persist a version" (create/update, which carry a version
 * `changeType`) vs "delete the Work" (which carries no changeType — a deletion has no
 * version to write). Keeping delete out of the changeType-bearing variant is what
 * eliminates the old `action: 'delete' → changeType: 'updated'` silent mis-mapping.
 */
export type ResolvedWorkRegistration =
  | { action: 'create' | 'update'; changeType: WorkVersionChangeType; targets: TaskWorkTarget[] }
  | { action: 'delete'; targets: TaskWorkTarget[] };

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
}): TaskWorkTarget[] => {
  const state = result.state as Record<string, unknown> | undefined;

  // Normalize both shapes into one candidate list, then run a single
  // success-filter → identity-map → drop-empty pipeline:
  // - Batch (`createTasks`): each `state.results[]` item, gated per item so a
  //   partially failed batch still registers its winners (top-level `success`
  //   is ignored here).
  // - Single (`createTask` / `editTask` / …): one synthetic item gated on the
  //   call's own `success`; the update identifier falls back to
  //   `args.identifier` when the server runtime returns no state.
  const items: any[] = Array.isArray(state?.results)
    ? state.results
    : result.success
      ? [
          {
            identifier: asString(state?.identifier) ?? asString((args as any)?.identifier),
            success: true,
            taskId: state?.taskId,
          },
        ]
      : [];

  return items
    .filter((item) => item && item.success === true)
    .map((item) => ({
      taskId: asString(item.taskId),
      taskIdentifier: asString(item.identifier),
    }))
    .filter((target) => Boolean(target.taskId || target.taskIdentifier));
};

/**
 * Resolve the manifest-driven Work registration plan for a tool API call, or
 * `undefined` when nothing should be registered (no `work` config, an
 * unsupported `resourceType`, or no extractable targets).
 *
 * Both dispatch layers call this so the "what to register" policy — including
 * which `resourceType`s are wired up — lives in exactly one place; each layer
 * then only owns its side-of-the-wire "how to persist" step.
 */
export const resolveWorkRegistration = (
  tools: LobeBuiltinTool[],
  identifier: string,
  apiName: string,
  payload: { args: unknown; result: Pick<BuiltinToolResult, 'state' | 'success'> },
): ResolvedWorkRegistration | undefined => {
  const config = getApiWorkConfig(tools, identifier, apiName);
  if (!config) return undefined;

  // `task` is the only resourceType wired through the dispatch layer today;
  // agentDocuments (`document`) follows in a later slice.
  if (config.resourceType !== 'task') return undefined;

  const targets = extractTaskWorkTargets(payload);
  if (targets.length === 0) return undefined;

  // `delete` locates the Work by `state.taskId` (the task row is already gone),
  // so it reuses the same target extraction but writes no version changeType.
  if (config.action === 'delete') return { action: 'delete', targets };

  return { action: config.action, changeType: workChangeTypeFromAction(config.action), targets };
};

/**
 * Tag a resolved task registration plan as the `task` variant of the runtime's
 * {@link WorkRegistrationIntent} union. Shared so both dispatch layers (server
 * `resolveBuiltinToolWorkIntent`, client `stashBuiltinToolWorkIntent`) emit the
 * exact same intent shape from one place — `delete` stays changeType-less, so the
 * discriminant is preserved end to end.
 */
export const toWorkRegistrationIntent = (
  resolved: ResolvedWorkRegistration,
): WorkRegistrationIntent =>
  resolved.action === 'delete'
    ? { action: 'delete', targets: resolved.targets, type: 'task' }
    : {
        action: resolved.action,
        changeType: resolved.changeType,
        targets: resolved.targets,
        type: 'task',
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
  actorAgentId?: string | null;
  cumulativeCost?: number | null;
  cumulativeUsage?: WorkVersionCumulativeUsage | null;
  rootOperationId?: string;
  sourceMessageId?: string;
  sourceToolCallId?: string;
  /** Fallback `sourceToolName` for task Works (the API name); skills/documents carry their own. */
  sourceToolName: string;
  threadId?: string | null;
  topicId?: string;
}

/**
 * The single "how to route a Work registration intent" implementation, consumed
 * by BOTH persistence dispatch layers — the server runtime
 * (`registerWorkFromIntent`, backed by `WorkModel`) and the legacy client
 * runtime (`registerClientWorkFromIntent`, backed by `workService`). Each layer
 * only supplies its own {@link WorkRegistrationPorts} and per-call
 * {@link WorkRegistrationProvenance}; the branch logic (task create/update/delete,
 * document register/delete, skill) lives here exactly once.
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
  const {
    actorAgentId,
    cumulativeCost,
    cumulativeUsage,
    rootOperationId,
    sourceMessageId,
    sourceToolCallId,
    sourceToolName,
    threadId,
    topicId,
  } = provenance;

  if (intent.type === 'task') {
    const { action, changeType, targets } = intent;

    if (action === 'delete') {
      await Promise.allSettled(
        targets
          .filter((target) => target.taskId)
          .map((target) => ports.deleteTaskWork({ taskId: target.taskId! })),
      );
      return;
    }

    if (!changeType) return;

    await Promise.allSettled(
      targets.map((target) =>
        ports.registerTask({
          actorAgentId,
          changeType,
          cumulativeCost,
          cumulativeUsage,
          rootOperationId,
          sourceMessageId,
          sourceToolCallId,
          sourceToolName,
          taskId: target.taskId,
          taskIdentifier: target.taskIdentifier,
          threadId,
          topicId,
        }),
      ),
    );
    return;
  }

  if (intent.type === 'document') {
    if (intent.action === 'delete') {
      // No-op when the port is absent (client): document deletes stay a
      // lambda-side effect of the removeDocument mutation.
      await ports.deleteDocumentWork?.(intent.document);
      return;
    }

    await ports.registerDocument({
      ...intent.document,
      actorAgentId,
      cumulativeCost,
      cumulativeUsage,
      rootOperationId,
      sourceMessageId,
      sourceToolCallId,
      threadId,
      topicId,
    });
    return;
  }

  // skill (linear / github): normalize the untruncated payload into a Work.
  await ports.handleSkillToolResult({
    actorAgentId,
    args: intent.args,
    cumulativeCost,
    cumulativeUsage,
    data: intent.data,
    provider: intent.provider,
    rootOperationId,
    sourceMessageId,
    sourceToolCallId,
    threadId,
    toolName: intent.toolName,
    topicId,
  });
};
