/**
 * What a failed environment action should say to the person.
 *
 * The server answers refusals in two shapes neither of which is a sentence:
 * a bare code such as `ENVIRONMENT_HAS_INSTANCES`, and, for input the router
 * rejected, the JSON of the validation issues. Both reached the toast verbatim,
 * so a refusal made on purpose read like a crash. Each is turned into the
 * message it stands for here; anything else is shown as it came, and an error
 * with no message at all — or one that is plainly machine output rather than a
 * sentence — falls back to the caller's generic line.
 */
const CODE_KEYS: Record<string, string> = {
  ENVIRONMENT_HAS_INSTANCES: 'environments.hasInstances',
  INSTANCE_IN_USE: 'environments.instances.inUse',
  PATH_OUTSIDE_INSTANCE: 'environments.files.invalidPath',
};

/**
 * A message the server never wrote for anyone to read.
 *
 * Drizzle raises a failed insert with the whole statement and its parameters in
 * `message`, and tRPC forwards that verbatim, so a missing column surfaced in a
 * dialog as a screenful of SQL — with the row's values in it. Anything of that
 * shape is dropped in favour of the caller's own line, which at least says
 * which action failed.
 *
 * Matched narrowly on purpose. The fallthrough below exists so that refusals
 * written as sentences still reach the person, and widening this to "anything
 * long" would swallow those too.
 */
const isMachineMessage = (message: string): boolean =>
  message.startsWith('Failed query:') ||
  // A stack trace that came along for the ride.
  /\n\s+at\s/.test(message);

const readIssues = (message: string): string[] | undefined => {
  if (!message.startsWith('[')) return;
  try {
    const parsed = JSON.parse(message) as unknown;
    if (
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed.every((issue) => typeof (issue as { message?: unknown })?.message === 'string')
    ) {
      return parsed.map((issue) => (issue as { message: string }).message);
    }
  } catch {
    // not JSON: an ordinary message that happens to start with a bracket
  }
};

export const describeError = (
  error: unknown,
  t: (key: any, options?: any) => string,
  fallback: string,
): string => {
  const message = (error as { message?: unknown })?.message;
  if (typeof message !== 'string' || !message) return fallback;

  const key = CODE_KEYS[message];
  if (key) return t(key);

  if (isMachineMessage(message)) return fallback;

  const issues = readIssues(message);
  if (issues) {
    if (issues.some((issue) => /relative path inside the workspace/i.test(issue))) {
      return t('environments.files.invalidPath');
    }
    return issues.join('; ');
  }

  return message;
};
