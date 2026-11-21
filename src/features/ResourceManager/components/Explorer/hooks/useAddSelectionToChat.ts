import { AGENT_CHAT_URL } from '@lobechat/const';
import { toast } from '@lobehub/ui';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useResourceManagerStore } from '@/features/ResourceManager/store';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { ragService } from '@/services/rag';
import { getAgentStoreState } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { fileChatSelectors, useFileStore } from '@/store/file';
import { isChunkingUnsupported } from '@/utils/isChunkingUnsupported';

import { buildChatAttachments } from '../chatAttachments';

/**
 * Put the selected library files into a new chat's input and open it.
 *
 * The library has no conversation of its own, so the files wait in the inbox
 * agent's new-topic input (the same hand-off the image viewer's "Ask in new
 * chat" uses). Nothing is sent; the user adds a question and sends it.
 */
export const useAddSelectionToChat = () => {
  const { t } = useTranslation('components');
  const navigate = useWorkspaceAwareNavigate();
  const [adding, setAdding] = useState(false);

  const addSelectionToChat = useCallback(async () => {
    const agentId = builtinAgentSelectors.inboxAgentId(getAgentStoreState());
    if (!agentId) {
      toast.error(t('FileManager.actions.addToChatError'));
      return;
    }

    setAdding(true);
    try {
      const resources = await useResourceManagerStore.getState().resolveSelectedResources();
      const contextKey = messageMapKey({ agentId, topicId: null });
      const fileStore = useFileStore.getState();
      const stagedIds = fileChatSelectors
        .chatUploadFileList(contextKey)(fileStore)
        .map((item) => item.id);
      const { alreadyAdded, files, skipped } = buildChatAttachments(resources, stagedIds);
      const count = files.length + alreadyAdded;

      if (count === 0) {
        toast.info(t('FileManager.actions.addToChatNoFiles'));
        return;
      }

      if (files.length > 0) {
        fileStore.dispatchChatUploadFileList(contextKey, { files, type: 'addFiles' });
      }
      // Same as a chat upload: parse documents up front so their text is ready for the model.
      for (const file of files) {
        if (isChunkingUnsupported(file.file.type)) continue;
        ragService.parseFileContent(file.id).catch((error) => {
          console.error('[ResourceExplorer] pre-parse for chat failed', error);
        });
      }

      useResourceManagerStore.getState().clearSelectAllState();
      navigate(AGENT_CHAT_URL(agentId));
      toast.success(
        skipped > 0
          ? t('FileManager.actions.addToChatPartial', { count, skipped })
          : t('FileManager.actions.addToChatSuccess', { count }),
      );
    } catch (error) {
      console.error('[ResourceExplorer] add selection to chat failed', error);
      toast.error(t('FileManager.actions.addToChatError'));
    } finally {
      setAdding(false);
    }
  }, [navigate, t]);

  return { addSelectionToChat, adding };
};
