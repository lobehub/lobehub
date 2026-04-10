import { type MenuProps } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { App } from 'antd';
import { PencilLineIcon, Trash } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { type RecentItem } from '@/server/routers/lambda/recent';
import { topicService } from '@/services/topic';
import { useChatStore } from '@/store/chat';
import { useHomeStore } from '@/store/home';

export const useRecentItemDropdownMenu = (
  item: RecentItem,
  toggleEditing: (visible?: boolean) => void,
) => {
  const { t } = useTranslation(['common', 'topic', 'components']);
  const { modal } = App.useApp();
  const removeTopic = useChatStore((s) => s.removeTopic);
  const [updateRecentTitle, removeRecent, refreshRecents] = useHomeStore((s) => [
    s.updateRecentTitle,
    s.removeRecent,
    s.refreshRecents,
  ]);

  const handleRename = useCallback(
    async (newTitle: string) => {
      // Optimistic update
      updateRecentTitle(item.id, newTitle);

      // Persist to server
      switch (item.type) {
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
        // Optimistic remove
        removeRecent(item.id);

        // Persist to server
        switch (item.type) {
          case 'topic': {
            await removeTopic(item.id);
            break;
          }
          case 'document': {
            break;
          }
        }
        // Refresh to get accurate data from server
        await refreshRecents();
      },
      title: confirmMessages[item.type] || t('delete', { ns: 'common' }),
    });
  }, [item, modal, t, removeTopic, removeRecent, refreshRecents]);

  const dropdownMenu = useCallback((): MenuProps['items'] => {
    const canRename = item.type !== 'task';

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
