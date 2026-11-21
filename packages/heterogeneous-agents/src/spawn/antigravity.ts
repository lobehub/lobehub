/** agy reads a single JSONL user message, then finishes the turn when stdin closes. */
export const ANTIGRAVITY_BASE_ARGS = [
  '--input-format',
  'stream-json',
  '--output-format',
  'stream-json',
  '--dangerously-skip-permissions',
] as const;

// agy 1.5.7+ defaults to Auto on supported systems. Use per-run settings
// so Full access does not depend on the CLI's saved sandbox or startup mode.
const FULL_ACCESS_SETTINGS = JSON.stringify({
  agentMode: '',
  allowNonWorkspaceAccess: true,
  enableTerminalSandbox: false,
});

interface AntigravitySpawnArgsOptions {
  extraArgs?: string[];
  resumeSessionId?: string;
}

const MANAGED_FLAGS = new Set([
  '--',
  '--input-format',
  '--output-format',
  '--print',
  '--prompt',
  '--prompt-interactive',
  '--remote-control',
  '-i',
  '-p',
  '--continue',
  '-c',
  '--conversation',
]);

export const buildAntigravityArgs = ({
  extraArgs = [],
  resumeSessionId,
}: AntigravitySpawnArgsOptions): string[] => {
  const conflicting = extraArgs.find((arg) => MANAGED_FLAGS.has(arg.split('=')[0]));
  if (conflicting) {
    throw new Error(
      `LobeHub manages Antigravity's prompt, output and session flags: ${conflicting}`,
    );
  }

  const hasCustomPermissionSettings = extraArgs.some((arg) =>
    ['--mode', '--sandbox', '--settings'].includes(arg.split('=')[0]),
  );

  return [
    ...ANTIGRAVITY_BASE_ARGS,
    ...(hasCustomPermissionSettings ? [] : ['--settings', FULL_ACCESS_SETTINGS]),
    ...(resumeSessionId ? ['--conversation', resumeSessionId] : []),
    ...extraArgs,
  ];
};
