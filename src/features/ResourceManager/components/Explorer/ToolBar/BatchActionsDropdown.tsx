import { type DropdownItem } from '@lobehub/ui';
import { DropdownMenu, Icon } from '@lobehub/ui';
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
import { useKnowledgeBaseStore } from '@/store/library';

import ActionIconWithChevron from './ActionIconWithChevron';

export type MultiSelectActionType =
  | 'addToKnowledgeBase'
  | 'moveToOtherKnowledgeBase'
  | 'batchChunking'
  | 'delete'
  | 'deleteLibrary'
  | 'removeFromKnowledgeBase';

interface BatchActionsDropdownProps {
  onActionClick: (type: MultiSelectActionType) => Promise<void>;
  selectCount: number;
}

const BatchActionsDropdown = memo<BatchActionsDropdownProps>(({ selectCount, onActionClick }) => {
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
        label: t('header.actions.deleteLibrary', { ns: 'file' }),
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
      disabled: selectCount === 0,
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
        disabled: selectCount === 0,
        icon: <Icon icon={BookMinusIcon} />,
        key: 'removeFromKnowledgeBase',
        label: t('FileManager.actions.removeFromLibrary'),
        onClick: () => {
          modal.confirm({
            okButtonProps: {
              danger: true,
            },
            onOk: async () => {
              await onActionClick('removeFromKnowledgeBase');
              message.success(t('FileManager.actions.removeFromLibrarySuccess'));
            },
            title: t('FileManager.actions.confirmRemoveFromLibrary', {
              count: selectCount,
            }),
          });
        },
      });

      if (availableKnowledgeBases.length > 0) {
        items.push({
          children: addToKnowledgeBaseSubmenu as any,
          disabled: selectCount === 0,
          icon: <Icon icon={BookPlusIcon} />,
          key: 'moveToOtherKnowledgeBase',
          label: t('FileManager.actions.moveToOtherLibrary'),
        });
      }
    } else if (availableKnowledgeBases.length > 0) {
      items.push({
        children: addToKnowledgeBaseSubmenu as any,
        disabled: selectCount === 0,
        icon: <Icon icon={BookPlusIcon} />,
        key: 'addToKnowledgeBase',
        label: t('FileManager.actions.addToLibrary'),
      });
    }

    items.push(
      {
        disabled: selectCount === 0,
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
        disabled: selectCount === 0,
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
    <DropdownMenu items={menuItems} placement="bottomLeft">
      <ActionIconWithChevron
        icon={CircleEllipsisIcon}
        title={t('FileManager.actions.batchActions', 'Batch actions')}
      />
    </DropdownMenu>
  );
});

BatchActionsDropdown.displayName = 'BatchActionsDropdown';

export default BatchActionsDropdown;
