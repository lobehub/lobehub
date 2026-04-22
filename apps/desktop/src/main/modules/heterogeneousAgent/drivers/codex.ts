import { JsonlStreamProcessor } from '../jsonlProcessor';
import type { HeterogeneousAgentBuildPlanParams, HeterogeneousAgentDriver } from '../types';

const CODEX_REQUIRED_ARGS = ['--json', '--skip-git-repo-check'] as const;
const CODEX_AUTO_EXECUTION_FLAGS = [
  '--full-auto',
  '--dangerously-bypass-approvals-and-sandbox',
  '--sandbox',
  '-s',
] as const;

const hasAnyFlag = (args: string[], flags: readonly string[]) =>
  args.some((arg) => flags.includes(arg as (typeof flags)[number]));

const buildCodexOptionArgs = async ({
  args,
  helpers,
  imageList,
}: Pick<HeterogeneousAgentBuildPlanParams, 'args' | 'helpers' | 'imageList'>) => {
  const imagePaths = await helpers.resolveCliImagePaths(imageList);
  const imageArgs = imagePaths.flatMap((filePath) => ['--image', filePath]);
  const autoExecutionArgs = hasAnyFlag(args, CODEX_AUTO_EXECUTION_FLAGS) ? [] : ['--full-auto'];

  return [...CODEX_REQUIRED_ARGS, ...autoExecutionArgs, ...imageArgs, ...args];
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
        : ['exec', ...optionArgs, '-'],
      stdinPayload: prompt,
    };
  },
  createStreamProcessor() {
    return new JsonlStreamProcessor({
      extractSessionId: (payload) =>
        payload?.type === 'thread.started' ? payload?.thread_id : undefined,
    });
  },
};
