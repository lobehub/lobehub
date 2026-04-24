import { JsonlStreamProcessor } from '../jsonlProcessor';
import type { HeterogeneousAgentBuildPlanParams, HeterogeneousAgentDriver } from '../types';

const CLAUDE_CODE_BASE_ARGS = [
  '-p',
  '--input-format',
  'stream-json',
  '--output-format',
  'stream-json',
  '--verbose',
  '--include-partial-messages',
  '--permission-mode',
  'bypassPermissions',
] as const;

export const claudeCodeDriver: HeterogeneousAgentDriver = {
  async buildSpawnPlan({
    args,
    helpers,
    imageList,
    prompt,
    resumeSessionId,
  }: HeterogeneousAgentBuildPlanParams) {
    const stdinPayload = await helpers.buildClaudeStreamJsonInput(prompt, imageList);

    return {
      args: [
        ...CLAUDE_CODE_BASE_ARGS,
        ...(resumeSessionId ? ['--resume', resumeSessionId] : []),
        ...args,
      ],
      stdinPayload,
    };
  },
  createStreamProcessor() {
    return new JsonlStreamProcessor({
      extractSessionId: (payload) =>
        payload?.type === 'system' && payload?.subtype === 'init' ? payload?.session_id : undefined,
    });
  },
};
