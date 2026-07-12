import type {
  BuiltinToolResult,
  LobeBuiltinTool,
  PluginApiWorkAction,
  PluginApiWorkConfig,
  WorkRegistrationIntent,
  WorkVersionRole,
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
 * `role`) vs "delete the Work" (which carries no role — a deletion has no
 * version to write). Keeping delete out of the role-bearing variant is what
 * eliminates the old `action: 'delete' → role: 'updated'` silent mis-mapping.
 */
export type ResolvedWorkRegistration =
  | { action: 'create' | 'update'; role: WorkVersionRole; targets: TaskWorkTarget[] }
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
 * Map a version-producing Work action onto the persisted version role. Only
 * `create` / `update` reach this — `delete` writes no version, so it is
 * deliberately excluded from the input type rather than silently mapped.
 */
export const workRoleFromAction = (
  action: Exclude<PluginApiWorkAction, 'delete'>,
): WorkVersionRole => (action === 'create' ? 'created' : 'updated');

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
  // so it reuses the same target extraction but writes no version role.
  if (config.action === 'delete') return { action: 'delete', targets };

  return { action: config.action, role: workRoleFromAction(config.action), targets };
};

/**
 * Tag a resolved task registration plan as the `task` variant of the runtime's
 * {@link WorkRegistrationIntent} union. Shared so both dispatch layers (server
 * `resolveBuiltinToolWorkIntent`, client `stashBuiltinToolWorkIntent`) emit the
 * exact same intent shape from one place — `delete` stays role-less, so the
 * discriminant is preserved end to end.
 */
export const toWorkRegistrationIntent = (
  resolved: ResolvedWorkRegistration,
): WorkRegistrationIntent =>
  resolved.action === 'delete'
    ? { action: 'delete', targets: resolved.targets, type: 'task' }
    : { action: resolved.action, role: resolved.role, targets: resolved.targets, type: 'task' };
