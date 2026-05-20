import { type MenuProps } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { App } from 'antd';
import { PencilLineIcon, Trash } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { type RecentItem } from '@/server/routers/lambda/recent';
import { documentService } from '@/services/document';
import { taskService } from '@/services/task';
import { topicService } from '@/services/topic';
import { useHomeStore } from '@/store/home';

export const useRecentItemDropdownMenu = (
  item: RecentItem,
  toggleEditing: (visible?: boolean) => void,
) => {
  const { t } = useTranslation(['common', 'topic', 'components']);
  const { modal } = App.useApp();
  const [updateRecentTitle, refreshRecents] = useHomeStore((s) => [
    s.updateRecentTitle,
    s.refreshRecents,
  ]);

  const handleRename = useCallback(
    async (newTitle: string) => {
      // Optimistic update
      updateRecentTitle(item.id, newTitle);

      // Persist to server
      switch (item.type) {
        case 'document': {
          await documentService.updateDocument({ id: item.id, title: newTitle });
          break;
        }
        case 'task': {
          await taskService.update(item.id, { name: newTitle });
          break;
        }
        case 'topic': {
          await topicService.updateTopic(item.id, { title: newTitle });
          break;
        }
      }
    },
    [item, updateRecentTitle],
  );

  const handleDelete = useCallback(() => {
    const confirmMessages: Record<string, string> = {
      document: t('FileManager.actions.confirmDelete', { ns: 'components' }),
      topic: t('actions.confirmRemoveTopic', { ns: 'topic' }),
    };

    modal.confirm({
      centered: true,
      okButtonProps: { danger: true },
      onOk: async () => {
        switch (item.type) {
          case 'topic': {
            // Home has no active agent/group, so chatStore.removeTopic early-returns; call the service directly
            await topicService.removeTopic(item.id);
            break;
          }
          case 'document': {
            await documentService.deleteDocument(item.id);
            break;
          }
          case 'task': {
            await taskService.delete(item.id);
            break;
          }
        }
        await refreshRecents();
      },
      title: confirmMessages[item.type] || t('delete', { ns: 'common' }),
    });
  }, [item, modal, t, refreshRecents]);

  const dropdownMenu = useCallback((): MenuProps['items'] => {
    const canRename = true;

    return [
      ...(canRename
        ? [
            {
              icon: <Icon icon={PencilLineIcon} />,
              key: 'rename',
              label: t('rename'),
              onClick: () => toggleEditing(true),
            },
          ]
        : []),
      {
        danger: true,
        icon: <Icon icon={Trash} />,
        key: 'delete',
        label: t('delete'),
        onClick: handleDelete,
      },
    ];
  }, [item.type, t, toggleEditing, handleDelete]);

  return { dropdownMenu, handleRename };
};
