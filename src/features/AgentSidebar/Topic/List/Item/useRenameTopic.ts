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
 * Opens the topic rename modal. Shared by the row's context/dropdown menu and
 * the row's double click, so both save and report errors the same way.
 *
 * Rows render by the dozen, so this reads the project scope from context and
 * refreshes the project list through the store on demand instead of mounting
 * `useScopedTopics` (an SWR subscription plus a mapped topic array) per row.
 */
export const useRenameTopic = (id: string | undefined, title: string) => {
  const { t } = useTranslation(['topic', 'common']);
  const { allowed: canRename } = usePermission('edit_own_content');
  const scope = useTopicListScope();
  const updateTopicTitle = useChatStore((s) => s.updateTopicTitle);
  const projectId = scope?.projectId;

  const openRename = useCallback(() => {
    if (!id || !canRename) return;

    openRenameModal({
      defaultValue: title,
      description: t('renameModal.description', { ns: 'topic' }),
      onSave: async (newTitle) => {
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
      title: t('renameModal.title', { ns: 'topic' }),
    });
  }, [canRename, id, projectId, t, title, updateTopicTitle]);

  return { canRename, openRename };
};
