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
  imageList,
}: Pick<HeterogeneousAgentBuildPlanParams, 'args' | 'helpers' | 'imageList'>) => {
  const imagePaths = await helpers.resolveCliImagePaths(imageList);
  const imageArgs = imagePaths.flatMap((filePath) => ['--image', filePath]);
  const executionModeArgs = hasAnyFlag(args, CODEX_EXECUTION_MODE_FLAGS)
    ? []
    : [...CODEX_DEFAULT_EXECUTION_ARGS];

  return [...CODEX_REQUIRED_ARGS, ...executionModeArgs, ...args, ...imageArgs];
};

export const codexDriver: HeterogeneousAgentDriver = {
  async buildSpawnPlan({
    args,
    helpers,
    imageList,
    prompt,
    resumeSessionId,
  }: HeterogeneousAgentBuildPlanParams) {
    const optionArgs = await buildCodexOptionArgs({ args, helpers, imageList });

    return {
      args: resumeSessionId
        ? ['exec', 'resume', ...optionArgs, resumeSessionId, '-']
        : ['exec', ...optionArgs],
      stdinPayload: prompt,
    };
  },
};
