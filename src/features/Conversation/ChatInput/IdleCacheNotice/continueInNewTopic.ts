import type { ConversationContext } from '@lobechat/types';

import { getDraft, saveDraft } from '@/features/ChatInput/draftStorage';
import type { ChatInputEditor } from '@/features/ChatInput/hooks/useChatInputEditor';
import { useChatStore } from '@/store/chat';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useFileStore } from '@/store/file';
import { appendEditorDocument } from '@/utils/appendEditorDocument';

/**
 * The conversation store holds the composer as the `useChatInputEditor` wrapper (typed `any`
 * there), not the raw `IEditor`; typing it here keeps a raw-editor method from compiling.
 */
type ComposerEditor = Pick<ChatInputEditor, 'clearContent' | 'getJSONState' | 'getMarkdownContent'>;

/**
 * Open a blank conversation with the same agent and carry the composer over: the draft text,
 * attachments and context selections the user staged for the next message.
 *
 * The draft is saved under the blank conversation's key before the switch and the editor is
 * emptied, so the composer's own key transition restores it there and removes it from the old
 * conversation instead of saving it under both. A blank conversation that already holds a draft
 * keeps it, with the carried one appended.
 *
 * Returns `false` without touching anything when the draft cannot be saved (for example, storage
 * is full): clearing the editor or switching would lose the unsent text.
 */
export const continueInNewTopic = async ({
  context,
  editor,
}: {
  context: ConversationContext;
  editor?: ComposerEditor | null;
}): Promise<boolean> => {
  const fromKey = messageMapKey(context);
  const toKey = messageMapKey({ agentId: context.agentId, topicId: null });

  if (fromKey !== toKey) {
    const draft = editor?.getMarkdownContent().trim() ? editor.getJSONState() : undefined;
    if (draft) {
      const existing = getDraft(toKey);
      const saved = saveDraft(toKey, existing ? appendEditorDocument(existing, draft) : draft);
      if (saved === undefined) return false;
      editor?.clearContent();
    }

    useFileStore.getState().moveChatComposerAttachments(fromKey, toKey);
  }

  await useChatStore.getState().openNewTopicOrSaveTopic();
  return true;
};
