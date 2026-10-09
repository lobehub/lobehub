import { isMachineErrorMessage } from '@/utils/machineErrorMessage';

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
  // The execution plane calls this an instance now too. The old
  // code is kept until that rename is deployed everywhere, so a refusal from a
  // server still on the previous build reads as a sentence rather than a code.
  ENVIRONMENT_IN_USE: 'environments.instances.inUse',
  INSTANCE_BUILDING: 'environments.instances.stopBuilding',
  INSTANCE_BUSY: 'environments.instances.stopBusy',
  INSTANCE_IN_USE: 'environments.instances.inUse',
  INSTANCE_STARTING: 'environments.instances.stopStarting',
  INSTANCE_STOP_FAILED: 'environments.instances.stopRefused',
  PATH_OUTSIDE_INSTANCE: 'environments.files.invalidPath',
  // Retryable on purpose: the run is still packing its snapshot, and the
  // execution plane would rather leave it running than cut the save off.
  SNAPSHOT_IN_PROGRESS: 'environments.instances.stopSnapshotPending',
};

/**
 * A refusal that arrived as a bare machine code this build has no sentence for
 * — a newer server, or a code only another surface handles. Printing it puts
 * `WORKSPACE_NOT_CONFIGURED` in front of someone; the caller's own line at
 * least names the action that failed.
 */
const isUntranslatedCode = (message: string): boolean => /^[A-Z][\dA-Z_]{2,}$/.test(message);

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

  if (isMachineErrorMessage(message) || isUntranslatedCode(message)) return fallback;

  const issues = readIssues(message);
  if (issues) {
    if (issues.some((issue) => /relative path inside the workspace/i.test(issue))) {
      return t('environments.files.invalidPath');
    }
    return issues.join('; ');
  }

  return message;
};
