import { SquarePen } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { getDraftEntry } from '@/features/ChatInput/draftStorage';
import { useChatStore } from '@/store/chat';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { fileChatSelectors, useFileStore } from '@/store/file';
import { plainTextToEditorDocument } from '@/utils/appendEditorDocument';

import { queueDraftForMainComposer, useComposerDraftBus } from '../../../../composerDraftBus';
import {
  conversationSelectors,
  messageStateSelectors,
  useConversationStore,
} from '../../../../store';
import { defineAction } from '../defineAction';
import { buildRestoredInput } from './buildRestoredInput';

/**
 * Open a new topic of the same agent with this user message — text plus every
 * image/file attachment — staged in its composer, unsent.
 *
 * Copy only carries text, so starting over in a clean context used to mean
 * re-attaching every image by hand. `restoreToInput` fills the *current*
 * composer, which a topic switch then swaps out; this hands the input to the
 * new topic's composer instead.
 *
 * Only the agent's main conversation offers it: the draft lands through
 * ComposerDraftReceiver, which is mounted there alone, and threads / groups /
 * side panels have no "new topic of this agent" to switch to.
 */
export const editInNewTopicAction = defineAction({
  key: 'editInNewTopic',
  useBuild: (ctx) => {
    const { t } = useTranslation('common');

    const context = useConversationStore((s) => s.context);
    const composerKey = useConversationStore(conversationSelectors.composerKey);
    const inThread = useConversationStore(messageStateSelectors.isThreadMode);
    // The main composer's receiver registers this conversation's key on the
    // bus; any other host (agent builder, page copilot, share) does not match.
    const isMainConversation = useComposerDraftBus(
      (s) => s.attached && s.contextKey === composerKey,
    );
    const [setPendingNewTopicDirectory, switchTopic] = useChatStore((s) => [
      s.setPendingNewTopicDirectory,
      s.switchTopic,
    ]);

    const { agentId, groupId, scope, threadId, topicId } = context;
    const eligible =
      ctx.role === 'user' &&
      isMainConversation &&
      !inThread &&
      !threadId &&
      !groupId &&
      (!scope || scope === 'main');

    return useMemo(() => {
      if (!eligible) return null;

      return {
        handleClick: async () => {
          const { editorData, files, markdown } = buildRestoredInput(ctx.data);

          // Attachments are keyed by composer, so stage them straight into the
          // new topic's bucket; they show up once the switch lands there.
          const newTopicKey = messageMapKey({ agentId, topicId: null });
          const fileStore = useFileStore.getState();
          const stagedFiles = fileChatSelectors.chatUploadFileList(newTopicKey)(fileStore);
          // The new topic may hold an unsent draft (saved text or staged
          // files); add to it instead of silently wiping it. Already on the
          // new topic, the live editor may hold text not yet saved, so add too.
          const keepExisting = !topicId || stagedFiles.length > 0 || !!getDraftEntry(newTopicKey);

          const stagedIds = new Set(stagedFiles.map((f) => f.id));
          const newFiles = files.filter((f) => !stagedIds.has(f.id));
          if (newFiles.length > 0) {
            fileStore.dispatchChatUploadFileList(newTopicKey, {
              files: newFiles,
              type: 'addFiles',
            });
          }

          // A targeted draft waits until the conversation settles on this
          // agent's new topic, so the switch cannot wipe the text.
          // Appending merges editor JSON so the draft's rich nodes survive; a
          // message saved without editor JSON joins as plain paragraphs instead
          // of reparsing the whole composer as Markdown.
          queueDraftForMainComposer(
            markdown,
            { agentId },
            {
              append: keepExisting,
              editorData:
                editorData ?? (keepExisting ? plainTextToEditorDocument(markdown) : undefined),
            },
          );

          if (topicId) {
            // Same as the "+" button: a plain topic, not one staged inside a
            // project directory.
            setPendingNewTopicDirectory();
            await switchTopic(null);
          }
        },
        icon: SquarePen,
        key: 'editInNewTopic',
        label: t('editInNewTopic'),
      };
    }, [eligible, t, ctx.data, agentId, topicId, setPendingNewTopicDirectory, switchTopic]);
  },
});
