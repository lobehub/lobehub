import type { ConversationContext } from '@lobechat/types';
import i18next from 'i18next';

import { type DraftGitSendResult, prepareDraftGitSend } from './prepareSend';
import { draftGitSendPrompts } from './sendPrompts';

let inFlight = false;

/**
 * The composer's entry to the send-time git step (see `prepareDraftGitSend`),
 * with the real prompts. A second send while one is still switching or
 * creating a worktree is refused rather than racing it.
 */
export const prepareComposerGitSend = async (
  context: Pick<ConversationContext, 'agentId' | 'groupId' | 'threadId' | 'topicId'>,
  editorData?: Record<string, any>,
): Promise<DraftGitSendResult> => {
  if (inFlight) return { ok: false };
  inFlight = true;
  try {
    return await prepareDraftGitSend(context, {
      editorData,
      prompts: draftGitSendPrompts,
      t: i18next.getFixedT(null, 'device'),
    });
  } finally {
    inFlight = false;
  }
};
