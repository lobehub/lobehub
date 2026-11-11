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
