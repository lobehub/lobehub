export type FtsSearchMigrationCommand =
  'apply' | 'promote' | 'purge' | 'release-lock' | 'retire' | 'skip-failure' | 'startup' | 'status';

/** Keep destructive intent explicit: retrying retirement must never advance into deletion. */
export const resolveFtsSearchMigrationCommand = (args: readonly string[]) => {
  const modes: FtsSearchMigrationCommand[] = [];
  for (const name of ['apply', 'promote', 'purge', 'retire', 'startup', 'status'] as const) {
    if (args.includes(`--${name}`)) modes.push(name);
  }
  if (args.some((argument) => argument.startsWith('--skip-failure='))) modes.push('skip-failure');
  const releaseArguments = args.filter((argument) => argument.startsWith('--release-lock='));
  if (releaseArguments.length > 1) throw new Error('--release-lock may only be provided once');
  const releaseLockOwner = releaseArguments[0]?.slice('--release-lock='.length);
  if (releaseLockOwner !== undefined) {
    if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(releaseLockOwner)) {
      throw new Error('--release-lock requires the exact owner UUID reported by --status');
    }
    modes.push('release-lock');
  }
  if (modes.length > 1) {
    throw new Error(
      'Choose exactly one migration command: --status, --apply, --startup, --promote, --retire, --purge, --skip-failure, or --release-lock',
    );
  }
  const command = modes[0] ?? 'status';
  if (command !== 'status' && !args.includes('--yes')) {
    throw new Error('Mutating commands require --yes after reviewing their documented effects');
  }
  if (command === 'startup') {
    const unsupported = args.find(
      (argument) =>
        argument === '--fresh-run' ||
        argument === '--in-place' ||
        argument.startsWith('--entity=') ||
        argument.startsWith('--max-batches-per-entity=') ||
        argument.startsWith('--version='),
    );
    if (unsupported) {
      throw new Error(`${unsupported.split('=')[0]} cannot be used with --startup`);
    }
  }
  if (args.includes('--fresh-run') && command !== 'apply') {
    throw new Error('--fresh-run can only be used with --apply');
  }
  if (args.includes('--in-place') && (command !== 'apply' || args.includes('--fresh-run'))) {
    throw new Error('--in-place can only be used with --apply on an existing generation');
  }
  if (
    (['promote', 'retire', 'purge'].includes(command) || args.includes('--in-place')) &&
    !args.some((argument) => argument.startsWith('--entity='))
  ) {
    throw new Error(
      `${args.includes('--in-place') ? '--in-place' : `--${command}`} requires at least one --entity=<entity>`,
    );
  }
  if (args.some((argument) => argument.startsWith('--version=')) && command !== 'promote') {
    throw new Error('--version can only be used with --promote');
  }
  return { command, releaseLockOwner };
};
