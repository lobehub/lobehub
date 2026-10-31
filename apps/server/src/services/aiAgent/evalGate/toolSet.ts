import { dropToolFromSet } from '../shareGate/toolSetMutation';
import type { ShareGateToolSet } from '../shareGate/types';

/**
 * Keep an eval attempt inside the case's environment: every tool identifier
 * that is not on the attempt's allowlist leaves the operation's tool set
 * before the first step — manifests, executors, sources, enabled and
 * activatable ids and the function-calling schema alike.
 *
 * `toolDiscovery` only narrows the candidate plugin list; always-on builtins
 * (local system, remote device, credentials, …) and every plugin the account
 * installed for other cases still land in `toolManifestMap`, where
 * `lobe-activator` can activate them mid-run. Without this pass a hidden
 * attempt agent reaches tools the case never gave it, and a case then fails
 * or passes on what the account happens to hold rather than on the model.
 * Same shape and position as {@link applyShareGateToToolSet}; the
 * `beforeToolCall` eval gate hook is the matching dispatch-time enforcement.
 */
export const applyEvalGateToToolSet = (
  toolSet: ShareGateToolSet,
  allowedTools: readonly string[],
): void => {
  const allowed = new Set(allowedTools);
  const present = new Set([
    ...Object.keys(toolSet.manifestMap),
    ...Object.keys(toolSet.executorMap),
    ...Object.keys(toolSet.sourceMap),
    ...toolSet.enabledToolIds,
    ...toolSet.activatableToolIds,
  ]);
  for (const identifier of present) {
    if (!allowed.has(identifier)) dropToolFromSet(toolSet, identifier);
  }
};
