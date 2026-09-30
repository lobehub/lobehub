/** agy reads a single JSONL user message, then finishes the turn when stdin closes. */
export const ANTIGRAVITY_BASE_ARGS = [
  '--input-format',
  'stream-json',
  '--output-format',
  'stream-json',
] as const;

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

  // Keep agy's cached credentials and permission policy. The user's explicit
  // permission flags can be supplied through extraArgs; never enable bypass here.
  return [
    ...ANTIGRAVITY_BASE_ARGS,
    ...(resumeSessionId ? ['--conversation', resumeSessionId] : []),
    ...extraArgs,
  ];
};
