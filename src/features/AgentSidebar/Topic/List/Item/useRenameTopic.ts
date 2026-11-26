import { toast } from '@lobehub/ui';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { openRenameModal } from '@/components/RenameModal';
import { usePermission } from '@/hooks/usePermission';
import { useChatStore } from '@/store/chat';
import { useProjectDirectoryStore } from '@/store/projectWorkingDirectory';
import { isForbiddenError } from '@/utils/forbiddenError';

import { useTopicListScope } from '../../TopicListScope';

/**
 * Renames a topic: `saveTitle` backs the sidebar row's inline editor, and
 * `openRename` opens the rename modal for surfaces without a row to edit in
 * (the topic manager, the project conversation header). Both save and report
 * errors the same way; `autoRename` serves the editor's button and the menu.
 *
 * Rows render by the dozen, so this reads the project scope from context and
 * refreshes the project lists through the store on demand rather than through
 * `useScopedTopics`, which adds an SWR subscription and a mapped topic array.
 */
export const useRenameTopic = (id: string | undefined, title: string, agentId?: string) => {
  const { t } = useTranslation(['topic', 'common']);
  const { allowed: canRename } = usePermission('edit_own_content');
  const scope = useTopicListScope();
  const [updateTopicTitle, autoRenameTopicTitle] = useChatStore((s) => [
    s.updateTopicTitle,
    s.autoRenameTopicTitle,
  ]);
  const projectId = scope?.projectId;

  const saveTitle = useCallback(
    async (newTitle: string) => {
      if (!id) return;
      try {
        await updateTopicTitle(id, newTitle);
        // A project list keeps its topics outside the chat store.
        if (projectId) await useProjectDirectoryStore.getState().refreshProjectTopics(projectId);
      } catch (error) {
        toast.error(
          isForbiddenError(error)
            ? t('manageOnlyCreator', { ns: 'common' })
            : t('operationFailed', { ns: 'common' }),
        );
      }
    },
    [id, projectId, t, updateTopicTitle],
  );

  /** Generates a title from the conversation. */
  const autoRename = useCallback(async () => {
    if (!id) return;
    await autoRenameTopicTitle(id, agentId);
    if (projectId) await useProjectDirectoryStore.getState().refreshProjectTopics(projectId);
  }, [agentId, autoRenameTopicTitle, id, projectId]);

  const openRename = useCallback(() => {
    if (!id || !canRename) return;

    openRenameModal({
      defaultValue: title,
      description: t('renameModal.description', { ns: 'topic' }),
      onSave: saveTitle,
      title: t('renameModal.title', { ns: 'topic' }),
    });
  }, [canRename, id, saveTitle, t, title]);

  return { autoRename, canRename, openRename, saveTitle };
};
