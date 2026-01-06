import { type DropdownItem, DropdownMenu, Icon } from '@lobehub/ui';
import { App } from 'antd';
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
import RepoIcon from '@/components/LibIcon';
import { useKnowledgeBaseStore } from '@/store/knowledgeBase';

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
    const { t } = useTranslation(['components', 'common', 'file', 'knowledgeBase']);
    const { modal, message } = App.useApp();

    const [libraryId, selectedFileIds] = useResourceManagerStore((s) => [
      s.libraryId,
      s.selectedFileIds,
    ]);
    const [useFetchKnowledgeBaseList, addFilesToKnowledgeBase] = useKnowledgeBaseStore((s) => [
      s.useFetchKnowledgeBaseList,
      s.addFilesToKnowledgeBase,
    ]);
    const { data: knowledgeBases } = useFetchKnowledgeBaseList();

    const menuItems = useMemo<DropdownItem[]>(() => {
      const items: DropdownItem[] = [];

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

      // Filter out current knowledge base and create submenu items
      const availableKnowledgeBases = (knowledgeBases || []).filter((kb) => kb.id !== libraryId);

      const addToKnowledgeBaseSubmenu: DropdownItem[] = availableKnowledgeBases.map((kb) => ({
        icon: <RepoIcon />,
        key: `add-to-kb-${kb.id}`,
        label: <span style={{ marginLeft: 8 }}>{kb.name}</span>,
        onClick: async () => {
          try {
            await addFilesToKnowledgeBase(kb.id, selectedFileIds);
            message.success(
              t('addToKnowledgeBase.addSuccess', {
                count: selectCount,
                ns: 'knowledgeBase',
              }),
            );
          } catch (e) {
            console.error(e);
            message.error(t('addToKnowledgeBase.error', { ns: 'knowledgeBase' }));
          }
        },
      }));

      if (libraryId) {
        items.push({
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
        });

        if (availableKnowledgeBases.length > 0) {
          items.push({
            children: addToKnowledgeBaseSubmenu as any,
            icon: <Icon icon={BookPlusIcon} />,
            key: 'addToOtherKnowledgeBase',
            label: t('FileManager.actions.addToOtherKnowledgeBase'),
          });
        }
      } else if (availableKnowledgeBases.length > 0) {
        items.push({
          children: addToKnowledgeBaseSubmenu as any,
          icon: <Icon icon={BookPlusIcon} />,
          key: 'addToKnowledgeBase',
          label: t('FileManager.actions.addToKnowledgeBase'),
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
    }, [
      libraryId,
      selectCount,
      selectedFileIds,
      onActionClick,
      addFilesToKnowledgeBase,
      t,
      modal,
      message,
      knowledgeBases,
    ]);

    return (
      <DropdownMenu items={menuItems} placement="bottomLeft" triggerProps={{ disabled }}>
        <ActionIconWithChevron
          disabled={disabled}
          icon={CircleEllipsisIcon}
          title={t('FileManager.actions.batchActions', 'Batch actions')}
        />
      </DropdownMenu>
    );
  },
);

BatchActionsDropdown.displayName = 'BatchActionsDropdown';

export default BatchActionsDropdown;
