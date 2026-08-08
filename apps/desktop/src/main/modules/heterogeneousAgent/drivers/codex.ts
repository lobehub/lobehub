import {
  CODEX_DEFAULT_EXECUTION_ARGS,
  CODEX_EXECUTION_MODE_FLAGS,
  CODEX_REQUIRED_ARGS,
} from '@lobechat/heterogeneous-agents/spawn';

import type { HeterogeneousAgentBuildPlanParams, HeterogeneousAgentDriver } from '../types';

const hasAnyFlag = (args: string[], flags: readonly string[]) =>
  args.some((arg) => flags.includes(arg as (typeof flags)[number]));

const buildCodexOptionArgs = async ({
  args,
  helpers,
  promptInput,
}: Pick<HeterogeneousAgentBuildPlanParams, 'args' | 'helpers' | 'promptInput'>) => {
  const inputPlan = await helpers.buildAgentInput('codex', promptInput);
  const executionModeArgs = hasAnyFlag(args, CODEX_EXECUTION_MODE_FLAGS)
    ? []
    : [...CODEX_DEFAULT_EXECUTION_ARGS];

  return {
    args: [...CODEX_REQUIRED_ARGS, ...executionModeArgs, ...args, ...inputPlan.args],
    stdinPayload: inputPlan.stdin,
  };
};

export const codexDriver: HeterogeneousAgentDriver = {
  async buildSpawnPlan({
    args,
    helpers,
    promptInput,
    resumeSessionId,
  }: HeterogeneousAgentBuildPlanParams) {
    const { args: optionArgs, stdinPayload } = await buildCodexOptionArgs({
      args,
      helpers,
      promptInput,
    });

    return {
      args: resumeSessionId
        ? ['exec', 'resume', ...optionArgs, resumeSessionId, '-']
        : ['exec', ...optionArgs],
      stdinPayload,
    };
  },
};
