import type { ConversationContext } from '@lobechat/types';
import i18next from 'i18next';

import { type DraftGitSendResult, prepareDraftGitSend, resolveDraftGitTarget } from './prepareSend';
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
export const prepareComposerGitSend = async (
  context: Pick<ConversationContext, 'agentId' | 'groupId' | 'threadId' | 'topicId'>,
  editorData?: Record<string, any>,
): Promise<DraftGitSendResult> => {
  const target = resolveDraftGitTarget(context, editorData);
  if (!target) return { ok: true };
  if (inFlight.has(target.agentId)) return { ok: false };
  inFlight.add(target.agentId);
  try {
    return await prepareDraftGitSend(context, {
      editorData,
      prompts: draftGitSendPrompts,
      t: i18next.getFixedT(null, 'device'),
    });
  } finally {
    inFlight.delete(target.agentId);
  }
};
