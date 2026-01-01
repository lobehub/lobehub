import { Icon } from '@lobehub/ui';
import { App, Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import {
  BookMinusIcon,
  BookPlusIcon,
  CircleEllipsisIcon,
  FileBoxIcon,
  Trash2Icon,
} from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useResourceManagerStore } from '@/app/[variants]/(main)/resource/features/store';

import ActionIconWithChevron from './ActionIconWithChevron';

export type MultiSelectActionType =
  | 'addToKnowledgeBase'
  | 'addToOtherKnowledgeBase'
  | 'batchChunking'
  | 'delete'
  | 'deleteLibrary'
  | 'removeFromKnowledgeBase';

interface BatchActionsDropdownProps {
  disabled?: boolean;
  onActionClick: (type: MultiSelectActionType) => Promise<void>;
  selectCount: number;
}

const BatchActionsDropdown = memo<BatchActionsDropdownProps>(
  ({ selectCount, onActionClick, disabled }) => {
    const { t } = useTranslation(['components', 'common', 'file']);
    const { modal, message } = App.useApp();

    const libraryId = useResourceManagerStore((s) => s.libraryId);

    const menuItems = useMemo<MenuProps['items']>(() => {
      const items: MenuProps['items'] = [];

      // Show delete library option only when in a knowledge base and no files selected
      if (libraryId && selectCount === 0) {
        items.push({
          danger: true,
          icon: <Icon icon={Trash2Icon} />,
          key: 'deleteLibrary',
          label: t('delete', { ns: 'common' }),
          onClick: async () => {
            modal.confirm({
              okButtonProps: {
                danger: true,
              },
              onOk: async () => {
                await onActionClick('deleteLibrary');
              },
              title: t('library.list.confirmRemoveLibrary', { ns: 'file' }),
            });
          },
        });
        return items;
      }

      if (libraryId) {
        items.push(
          {
            icon: <Icon icon={BookMinusIcon} />,
            key: 'removeFromKnowledgeBase',
            label: t('FileManager.actions.removeFromKnowledgeBase'),
            onClick: () => {
              modal.confirm({
                okButtonProps: {
                  danger: true,
                },
                onOk: async () => {
                  await onActionClick('removeFromKnowledgeBase');
                  message.success(t('FileManager.actions.removeFromKnowledgeBaseSuccess'));
                },
                title: t('FileManager.actions.confirmRemoveFromKnowledgeBase', {
                  count: selectCount,
                }),
              });
            },
          },
          {
            icon: <Icon icon={BookPlusIcon} />,
            key: 'addToOtherKnowledgeBase',
            label: t('FileManager.actions.addToOtherKnowledgeBase'),
            onClick: () => {
              onActionClick('addToOtherKnowledgeBase');
            },
          },
        );
      } else {
        items.push({
          icon: <Icon icon={BookPlusIcon} />,
          key: 'addToKnowledgeBase',
          label: t('FileManager.actions.addToKnowledgeBase'),
          onClick: () => {
            onActionClick('addToKnowledgeBase');
          },
        });
      }

      items.push(
        {
          icon: <Icon icon={FileBoxIcon} />,
          key: 'batchChunking',
          label: t('FileManager.actions.batchChunking'),
          onClick: async () => {
            await onActionClick('batchChunking');
          },
        },
        {
          type: 'divider',
        },
        {
          danger: true,
          icon: <Icon icon={Trash2Icon} />,
          key: 'delete',
          label: t('delete', { ns: 'common' }),
          onClick: async () => {
            modal.confirm({
              okButtonProps: {
                danger: true,
              },
              onOk: async () => {
                await onActionClick('delete');
                message.success(t('FileManager.actions.deleteSuccess'));
              },
              title: t('FileManager.actions.confirmDeleteMultiFiles', { count: selectCount }),
            });
          },
        },
      );

      return items;
    }, [libraryId, selectCount, onActionClick, t, modal, message]);

    return (
      <Dropdown
        disabled={disabled}
        menu={{ items: menuItems }}
        placement="bottomLeft"
        trigger={['click']}
      >
        <ActionIconWithChevron
          disabled={disabled}
          icon={CircleEllipsisIcon}
          title={t('FileManager.actions.batchActions', 'Batch actions')}
        />
      </Dropdown>
    );
  },
);

BatchActionsDropdown.displayName = 'BatchActionsDropdown';

export default BatchActionsDropdown;
