export interface ElasticsearchFtsSearchSyncCliOptions {
  /**
   * When set, the CLI keeps repeating bounded drains and sleeps this many seconds between runs
   * that found no more work. Undefined means one bounded run, which suits cron-style scheduling.
   */
  intervalSeconds?: number;
  maxSteps: number;
  yes: boolean;
}

const MAX_ALLOWED_STEPS = 100;
const MAX_ALLOWED_INTERVAL_SECONDS = 3600;

const readIntegerArgument = (
  args: readonly string[],
  name: string,
  { max, min }: { max: number; min: number },
): number | undefined => {
  const matches = args.filter((argument) => argument.startsWith(`${name}=`));
  if (matches.length > 1) throw new Error(`${name} can only be provided once`);

  const raw = matches[0]?.slice(name.length + 1);
  if (raw === undefined) return;

  const value = Number.parseInt(raw, 10);
  if (
    !Number.isInteger(value) ||
    raw === '' ||
    String(value) !== raw ||
    value < min ||
    value > max
  ) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
};

export const parseElasticsearchFtsSearchSyncCliOptions = (
  args: readonly string[],
): ElasticsearchFtsSearchSyncCliOptions => {
  const knownFlags = new Set(['--yes']);
  const knownValueArguments = ['--interval-seconds=', '--max-steps='];
  const unknownArgument = args.find(
    (argument) =>
      !knownFlags.has(argument) &&
      !knownValueArguments.some((prefix) => argument.startsWith(prefix)),
  );
  if (unknownArgument) throw new Error(`Unknown argument: ${unknownArgument}`);

  const maxSteps = readIntegerArgument(args, '--max-steps', { max: MAX_ALLOWED_STEPS, min: 1 });
  const intervalSeconds = readIntegerArgument(args, '--interval-seconds', {
    max: MAX_ALLOWED_INTERVAL_SECONDS,
    min: 1,
  });

  return {
    ...(intervalSeconds === undefined ? {} : { intervalSeconds }),
    maxSteps: maxSteps ?? 1,
    yes: args.includes('--yes'),
  };
};
