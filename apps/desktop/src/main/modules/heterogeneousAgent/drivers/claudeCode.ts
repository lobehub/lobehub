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
  // CC's built-in `AskUserQuestion` self-injects an `is_error: "Answer questions?"`
  // tool_result inside the CLI before the host gets a chance to surface the
  // questions, leaving the model to fall back to plain-text prompting anyway.
  // Disable it so the model just asks in text. Re-enable once we wire a
  // local MCP-backed replacement that bridges to LobeHub's intervention UI.
  '--disallowedTools',
  'AskUserQuestion',
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
};
