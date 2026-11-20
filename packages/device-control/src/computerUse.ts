/**
 * The device side of the `lobe-computer-use/runCommand` tool: which AUV
 * command lines a device accepts, how one runs, and what the tool returns.
 * Shared by the desktop app and `lh connect` so both devices expose the same
 * contract.
 */

/**
 * Tool identifier a device lists in `supportedTools` when it can run Computer
 * Use. Mirrors `AuvIdentifier` in `@lobechat/builtin-tool-auv`, which device
 * runtimes do not import because it carries the React inspector.
 */
export const COMPUTER_USE_IDENTIFIER = 'lobe-computer-use';

/** Arguments of one `runCommand` call, after the `auv` executable. */
export interface AuvRunCommandParams {
  argv: string[];
}

export interface AuvRunCommandResult {
  argv: string[];
  /** Process exit status, not verification of the requested UI effect. */
  exitCode: number;
  output: unknown;
  stderr?: string;
}

/** Runs the AUV CLI once; rejects with an `execFile` error on a nonzero exit. */
export type AuvCliExec = (argv: string[]) => Promise<{ stderr: string; stdout: string }>;

const MAX_CLI_ARGUMENTS = 128;
const MAX_CLI_ARGUMENT_LENGTH = 16_384;
const AUV_COMMAND_ID = /^[a-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)+$/;

/**
 * Validates the model's argv and returns the command line to run: only
 * `auv invoke <command>` or its help, never a caller-chosen `--store-root`, and
 * `--json` added unless help is requested.
 */
export const normalizeAuvArgv = (params: AuvRunCommandParams): string[] => {
  if (!Array.isArray(params.argv)) throw new Error('AUV argv must be an array');
  if (params.argv.length < 2) {
    throw new Error('AUV argv must include "invoke" and a command or --help');
  }
  if (params.argv.length > MAX_CLI_ARGUMENTS) {
    throw new Error(`AUV argv cannot contain more than ${MAX_CLI_ARGUMENTS} arguments`);
  }

  const argv = params.argv.map((argument) => {
    if (typeof argument !== 'string') throw new Error('Every AUV argument must be a string');
    if (argument.includes('\0')) throw new Error('AUV arguments cannot contain NUL bytes');
    if (argument.length > MAX_CLI_ARGUMENT_LENGTH) {
      throw new Error(`AUV arguments cannot exceed ${MAX_CLI_ARGUMENT_LENGTH} characters`);
    }
    return argument;
  });

  if (argv[0] !== 'invoke') {
    throw new Error('Only "auv invoke" commands are allowed');
  }
  if (
    argv.some((argument) => argument === '--store-root' || argument.startsWith('--store-root='))
  ) {
    throw new Error('AUV --store-root is managed by LobeHub');
  }

  const command = argv[1]!;
  if (
    command !== '--help' &&
    command !== '-h' &&
    command !== 'help' &&
    !AUV_COMMAND_ID.test(command)
  ) {
    throw new Error(`Invalid AUV invoke command: ${command}`);
  }

  const isHelp = argv.includes('--help') || argv.includes('-h') || command === 'help';
  if (!isHelp && !argv.includes('--json')) argv.push('--json');
  return argv;
};

const parseCliOutput = (stdout: string): unknown => {
  const output = stdout.trim();
  if (!output) return null;

  try {
    return JSON.parse(output);
  } catch {
    return output;
  }
};

/**
 * Runs a command line from {@link normalizeAuvArgv} and keeps AUV's structured
 * failure: `execFile` rejects a nonzero exit even when stdout holds the failure
 * envelope, so that exit becomes a result. Spawn failures and timeouts still throw.
 */
export const runAuvCommand = async (
  params: AuvRunCommandParams,
  argv: string[],
  exec: AuvCliExec,
): Promise<AuvRunCommandResult> => {
  let stdout: string;
  let stderr: string;
  let exitCode = 0;
  try {
    ({ stderr, stdout } = await exec(argv));
  } catch (error) {
    const failure = error as { code?: unknown; killed?: boolean; stderr?: string; stdout?: string };
    if (typeof failure?.code !== 'number' || failure.killed) throw error;
    exitCode = failure.code;
    stdout = failure.stdout ?? '';
    stderr = failure.stderr ?? '';
  }
  const stderrOutput = stderr.trim();

  return {
    argv: [...params.argv],
    exitCode,
    output: parseCliOutput(stdout),
    ...(stderrOutput && { stderr: stderrOutput }),
  };
};

/** The gateway tool-call result for one `runCommand` run. */
export const toAuvToolOutput = (result: AuvRunCommandResult) => ({
  content: JSON.stringify(result),
  ...(result.exitCode !== 0 && {
    error: result.stderr || `Computer Use exited with code ${result.exitCode}`,
  }),
  state: result,
  success: result.exitCode === 0,
});
