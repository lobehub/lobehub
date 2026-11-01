export type MoveTopicToTargetResult = 'moved' | 'target-not-saved' | 'topic-not-saved';

interface MoveTopicToTargetParams {
  /** Runs once the topic is re-pinned, e.g. giving a sandboxed run a directory. */
  afterRepin?: () => Promise<void>;
  /** Re-pin the topic and drop its old machine's directory and session. */
  repinTopic: () => Promise<void>;
  /** Persist the new execution target; resolves whether it was saved. */
  saveTarget: () => Promise<boolean>;
}

/**
 * Move a device-bound topic to another execution target.
 *
 * The target is saved first: re-pinning erases the topic's directory and CLI
 * session, so doing it before a save that is refused or fails would leave the
 * topic half-switched — stripped of its state while the target never changed.
 */
export const moveTopicToTarget = async ({
  afterRepin,
  repinTopic,
  saveTarget,
}: MoveTopicToTargetParams): Promise<MoveTopicToTargetResult> => {
  if (!(await saveTarget())) return 'target-not-saved';

  try {
    await repinTopic();
  } catch {
    return 'topic-not-saved';
  }

  await afterRepin?.();
  return 'moved';
};
