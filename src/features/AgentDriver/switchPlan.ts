import type { LobeAgentConfig } from '@lobechat/types';
import type { PartialDeep } from 'type-fest';

/**
 * What an agent runs on: LobeHub's own harness (the model and tools are chosen here),
 * or a heterogeneous agent that brings its own runtime (Claude Code, Codex, …).
 */
export type DriverTarget = { kind: 'harness' } | { command?: string; kind: 'hetero'; type: string };

interface DefaultChatModel {
  model: string;
  provider: string;
}

/**
 * The chat model a shared agent lands on when it moves back to the LobeHub harness.
 *
 * Moving back writes the account's default model, but a shared agent may only use models from
 * the providers sharing allows: the server rejects anything else, and the person would be told
 * to change a global setting on another page before they could switch. So when the default is
 * not allowed, pick an allowed model instead — the deployment default when it is one, then a
 * model with the same id, then the first allowed model. With no allowed model available the
 * account default is kept and the server's rejection is reported as a failed switch.
 */
export const resolveHarnessModel = ({
  allowedProviders,
  defaults,
  enabledChatModels,
  fallback,
}: {
  /** Providers a shared agent may use; `undefined` when sharing restricts none. */
  allowedProviders?: readonly string[];
  defaults: DefaultChatModel;
  enabledChatModels: { children: { id: string }[]; id: string }[];
  /** The deployment's default chat model. */
  fallback: DefaultChatModel;
}): DefaultChatModel => {
  if (!allowedProviders || allowedProviders.includes(defaults.provider)) return defaults;

  const allowed = enabledChatModels.filter(
    (provider) => allowedProviders.includes(provider.id) && provider.children.length > 0,
  );
  const find = (model: string, provider?: string) =>
    allowed.find(
      (item) =>
        (!provider || item.id === provider) && item.children.some((child) => child.id === model),
    );

  const fallbackProvider = find(fallback.model, fallback.provider);
  if (fallbackProvider) return fallback;

  const sameModel = find(defaults.model);
  if (sameModel) return { model: defaults.model, provider: sameModel.id };

  const first = allowed[0];
  return first ? { model: first.children[0].id, provider: first.id } : defaults;
};

/**
 * The config writes that move an agent to another driver, in the order they must land.
 *
 * Why not one patch: `updateConfig` deep-merges, so writing the new provider over the old
 * one would keep the old driver's `env`, `authMode` and `apiConfig` — credentials and
 * routing that mean nothing (or something wrong) to the new runtime. Clearing the whole
 * block first and writing the new one second leaves nothing behind.
 *
 * A heterogeneous agent is stamped with its type as `provider` (run attribution, agent
 * list, message tags read it), so leaving a driver must hand `provider` back to a real
 * chat provider, or those readers would keep attributing runs to the old runtime.
 */
export const planDriverSwitch = ({
  currentlyHeterogeneous,
  defaults,
  target,
}: {
  currentlyHeterogeneous: boolean;
  defaults: DefaultChatModel;
  target: DriverTarget;
}): PartialDeep<LobeAgentConfig>[] => {
  const clear = { agencyConfig: { heterogeneousProvider: null } };

  if (target.kind === 'harness') {
    return [
      {
        ...clear,
        model: defaults.model,
        provider: defaults.provider,
      } as unknown as PartialDeep<LobeAgentConfig>,
    ];
  }

  const apply = {
    agencyConfig: { heterogeneousProvider: { command: target.command, type: target.type } },
    provider: target.type,
  } as unknown as PartialDeep<LobeAgentConfig>;

  return currentlyHeterogeneous
    ? [clear as unknown as PartialDeep<LobeAgentConfig>, apply]
    : [apply];
};

/**
 * The write that puts a heterogeneous agent back as it was, for when a switch between two
 * heterogeneous drivers fails after the first driver was cleared. Two requests cannot be one
 * transaction here, so the failure path restores instead: the old provider block and its
 * `provider` stamp are written back, which leaves the agent on its previous driver rather than
 * half way to the harness.
 */
export const planDriverRollback = ({
  heterogeneousProvider,
  provider,
}: {
  heterogeneousProvider: unknown;
  provider?: string;
}): PartialDeep<LobeAgentConfig> =>
  ({
    agencyConfig: { heterogeneousProvider },
    provider,
  }) as unknown as PartialDeep<LobeAgentConfig>;

interface DriverWriteOptions {
  rethrow: true;
  showErrorMessage: false;
}

/**
 * The store's config writer: by default it reports a failed save with its own toast and resolves,
 * so a caller cannot tell success from failure. A driver switch needs the failure to roll back and
 * to replace the success toast, so every write here asks for the error and keeps the store quiet.
 */
type DriverConfigWriter = (
  agentId: string,
  patch: PartialDeep<LobeAgentConfig>,
  options: DriverWriteOptions,
) => Promise<void>;

const DRIVER_WRITE_OPTIONS: DriverWriteOptions = { rethrow: true, showErrorMessage: false };

const isAbortError = (error: unknown) =>
  error instanceof Error && (error.name === 'AbortError' || error.message.includes('aborted'));

/**
 * Land a driver switch plan and say how it ended, so the caller shows exactly one outcome.
 *
 * - `switched`: every write was saved.
 * - `failed`: a write was rejected; a clear-then-write switch has been rolled back to `previous`.
 * - `superseded`: a newer config write for this agent aborted ours, and that write owns the outcome.
 */
export const runDriverSwitch = async ({
  agentId,
  plan,
  previous,
  write,
}: {
  agentId: string;
  plan: PartialDeep<LobeAgentConfig>[];
  previous: { heterogeneousProvider: unknown; provider?: string };
  write: DriverConfigWriter;
}): Promise<'failed' | 'superseded' | 'switched'> => {
  try {
    // Sequential on purpose: the second write must merge into the cleared block.
    for (const patch of plan) await write(agentId, patch, DRIVER_WRITE_OPTIONS);
    return 'switched';
  } catch (error) {
    if (isAbortError(error)) return 'superseded';

    // Switching between two external drivers is clear-then-write. If the write fails after the
    // clear, put the previous driver back rather than leave the agent on LobeHub with a stale
    // provider stamp.
    if (plan.length > 1 && previous.heterogeneousProvider) {
      try {
        await write(agentId, planDriverRollback(previous), DRIVER_WRITE_OPTIONS);
      } catch {
        // The caller's failure message still tells the person the switch did not happen.
      }
    }
    return 'failed';
  }
};
