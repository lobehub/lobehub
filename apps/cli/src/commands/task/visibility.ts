import { formatError } from '../../utils/error';

export type TaskVisibility = 'private' | 'public';

export const TASK_VISIBILITIES: readonly TaskVisibility[] = ['private', 'public'];

export const VISIBILITY_OPTION_DESCRIPTION =
  'Task visibility: private (only you) or public (the whole workspace)';

/** Validate `--visibility`; throws a message listing the accepted values. */
export const parseVisibility = (value: string | undefined): TaskVisibility | undefined => {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if ((TASK_VISIBILITIES as readonly string[]).includes(normalized)) {
    return normalized as TaskVisibility;
  }
  throw new Error(`Invalid visibility "${value}". Must be one of: ${TASK_VISIBILITIES.join(', ')}`);
};

// Matches the message of `TaskService.assertAgentVisibilityCompat`
// (apps/server/src/services/task/index.ts), which carries no error code.
const PRIVATE_AGENT_ON_PUBLIC_TASK = /public task cannot be assigned to a private agent/i;

/**
 * Append how to fix a failed create / edit when the server's message has a
 * CLI-side remedy. The server message itself is kept verbatim; other errors
 * pass through unchanged so the global handler still recognizes them.
 */
export const withVisibilityHint = (
  error: unknown,
  context: { command: 'create' } | { command: 'edit'; id: string },
): unknown => {
  const message = formatError(error);
  if (!PRIVATE_AGENT_ON_PUBLIC_TASK.test(message)) return error;

  const hint =
    context.command === 'create'
      ? 'Create it with `--visibility private` instead.'
      : `Add \`--visibility private\` to this command, or run \`lh task edit ${context.id} --visibility private\` first (only the task creator can make it private).`;
  // No `cause`: the global handler prints the whole cause chain, which would
  // repeat the server message.
  return new Error(`${message}\nHint: ${hint}`);
};

/**
 * Prefix a failed `updateVisibility` call with what was being attempted; the
 * server's reason (e.g. only the creator can make a task private) stays
 * verbatim. `appliedOtherEdits` notes that the rest of the edit already landed.
 */
export const describeVisibilityError = (
  error: unknown,
  id: string,
  visibility: TaskVisibility,
  appliedOtherEdits = false,
): Error => {
  const applied = appliedOtherEdits ? ' (the other changes in this command were applied)' : '';
  return new Error(`Could not make ${id} ${visibility}${applied}: ${formatError(error)}`);
};
