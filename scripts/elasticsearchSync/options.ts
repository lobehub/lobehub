export interface ElasticsearchFtsSearchSyncCliOptions {
  maxSteps: number;
  yes: boolean;
}

const MAX_ALLOWED_STEPS = 100;

export const parseElasticsearchFtsSearchSyncCliOptions = (
  args: readonly string[],
): ElasticsearchFtsSearchSyncCliOptions => {
  const knownFlags = new Set(['--yes']);
  const unknownArgument = args.find(
    (argument) => !knownFlags.has(argument) && !argument.startsWith('--max-steps='),
  );
  if (unknownArgument) throw new Error(`Unknown argument: ${unknownArgument}`);

  const maxStepArguments = args.filter((argument) => argument.startsWith('--max-steps='));
  if (maxStepArguments.length > 1) throw new Error('--max-steps can only be provided once');

  const rawMaxSteps = maxStepArguments[0]?.slice('--max-steps='.length);
  const maxSteps = rawMaxSteps === undefined ? 1 : Number.parseInt(rawMaxSteps, 10);
  if (
    !Number.isInteger(maxSteps) ||
    rawMaxSteps === '' ||
    (rawMaxSteps !== undefined && String(maxSteps) !== rawMaxSteps) ||
    maxSteps < 1 ||
    maxSteps > MAX_ALLOWED_STEPS
  ) {
    throw new Error(`--max-steps must be an integer between 1 and ${MAX_ALLOWED_STEPS}`);
  }

  return { maxSteps, yes: args.includes('--yes') };
};
