import type { ChatTopic, ChatTopicStatus } from '@lobechat/types';

import { isInterventionRunActive } from '@/store/chat/utils/interventionSync';

/**
 * Retire the local `running` row of an external hetero run whose session ended
 * without its terminal frame — but only once the server no longer backs any run
 * on the topic.
 *
 * The gateway transport never settles such a run itself (the CLI may still be
 * producing), and it completes the local operation, so nothing else is left to
 * retire the row: the stale-run sweep only considers topics that still have a
 * running local operation. A run whose dispatch the server failed before the
 * CLI ever wrote ends exactly like this, and kept the sidebar spinning over a
 * failed turn until a topic-list refetch.
 *
 * Never settles anything server-side, and an unreadable row is not evidence the
 * run ended. Mirrors the server's own terminal status unless the user is
 * watching, which pins `active` like the terminal-frame path.
 *
 * Returns whether the local row was retired.
 */
export const retireLocalRowIfServerSettled = async (params: {
  clear: (status: ChatTopicStatus) => void;
  isViewing: () => boolean;
  readTopic: () => Promise<ChatTopic | null | undefined>;
}): Promise<boolean> => {
  const { clear, isViewing, readTopic } = params;

  let topic: ChatTopic | null | undefined;
  try {
    topic = await readTopic();
  } catch (error) {
    console.error('[Gateway] External producer topic read failed:', error);
    return false;
  }
  if (!topic || isInterventionRunActive(topic)) return false;

  clear(isViewing() ? 'active' : (topic.status ?? 'active'));
  return true;
};
