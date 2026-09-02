export type PgSearchCleanupOptions = { mode: 'status' } | { mode: 'apply'; yes: true };

export const parsePgSearchCleanupOptions = (args: readonly string[]): PgSearchCleanupOptions => {
  const knownArguments = new Set(['--apply', '--status', '--yes']);
  const unknownArgument = args.find((argument) => !knownArguments.has(argument));
  if (unknownArgument) throw new Error(`Unknown argument: ${unknownArgument}`);

  const modes = ['--apply', '--status'].filter((mode) => args.includes(mode));
  if (modes.length > 1) throw new Error('Choose exactly one of --apply or --status');

  const mode = modes[0] ?? '--status';
  if (mode === '--status') {
    if (args.some((argument) => argument !== '--status')) {
      throw new Error('--status does not accept mutation arguments');
    }
    return { mode: 'status' };
  }

  if (!args.includes('--yes')) {
    throw new Error('--apply requires --yes after reviewing the cleanup status');
  }

  return { mode: 'apply', yes: true };
};
