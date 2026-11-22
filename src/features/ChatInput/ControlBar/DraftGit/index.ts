import type { ConversationContext } from '@lobechat/types';
import i18next from 'i18next';

import {
  type DraftGitSendResult,
  type DraftGitSnapshot,
  prepareDraftGitSend,
  snapshotDraftGit,
} from './prepareSend';
import { draftGitSendPrompts } from './sendPrompts';

/** Agents whose new-topic composer is switching a branch or creating a worktree now. */
const inFlight = new Set<string>();

/**
 * The composer's entry to the send-time git step (see `prepareDraftGitSend`),
 * with the real prompts. Sends with nothing to prepare (an existing topic, the
 * lab off, another agent's composer) pass straight through; only a second send
 * from the same composer while its git step runs is refused, rather than
 * racing it.
 */
export { needsSendTimeGit, snapshotDraftGit } from './prepareSend';

export const prepareComposerGitSend = async (
  context: Pick<ConversationContext, 'agentId' | 'groupId' | 'threadId' | 'topicId'>,
  options: {
    editorData?: Record<string, any>;
    /**
     * Taken when the user sent, for a send that runs later (a voice turn);
     * `null` means there was nothing to prepare then. Omitted, it is read now.
     */
    snapshot?: DraftGitSnapshot | null;
  } = {},
): Promise<DraftGitSendResult> => {
  const { editorData } = options;
  const snapshot =
    options.snapshot === undefined ? snapshotDraftGit(context, editorData) : options.snapshot;
  if (!snapshot) return { ok: true };
  const { target } = snapshot;
  if (inFlight.has(target.agentId)) return { ok: false };
  inFlight.add(target.agentId);
  try {
    return await prepareDraftGitSend(context, {
      editorData,
      prompts: draftGitSendPrompts,
      snapshot,
      t: i18next.getFixedT(null, 'device'),
    });
  } finally {
    inFlight.delete(target.agentId);
  }
};
