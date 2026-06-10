'use client';

import { ActionIcon, Flexbox } from '@lobehub/ui';
import { confirmModal } from '@lobehub/ui/base-ui';
import { App } from 'antd';
import { cssVar } from 'antd-style';
import { BookMinusIcon, FileBoxIcon, Trash2Icon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useFileBatchTransferActions } from '@/business/client/hooks/useFileBatchTransferActions';
import NavHeader from '@/features/NavHeader';
import { usePermission } from '@/hooks/usePermission';
import { useResourceManagerStore } from '@/routes/(main)/resource/features/store';
import { getExplorerSelectedCount } from '@/routes/(main)/resource/features/store/selectors';
import { useFileStore } from '@/store/file';
import { FilesTabs } from '@/types/files';

import AddButton from '../../Header/AddButton';
import BatchActionsDropdown from '../ToolBar/BatchActionsDropdown';
import SortDropdown from '../ToolBar/SortDropdown';
import ViewSwitcher from '../ToolBar/ViewSwitcher';
import Breadcrumb from './Breadcrumb';
import SearchInput from './SearchInput';

/**
 * Toolbar for the resource explorer
 */
const Header = memo(() => {
  const { t } = useTranslation(['components', 'common', 'file', 'knowledgeBase']);
  const { message } = App.useApp();

  // Get state and actions from store
  const [libraryId, category, onActionClick, selectAllState, selectFileIds] =
    useResourceManagerStore((s) => [
      s.libraryId,
      s.category,
      s.onActionClick,
      s.selectAllState,
      s.selectedFileIds,
    ]);
  const { allowed: canEditResources, reason } = usePermission('edit_own_content');
  const total = useFileStore((s) => s.total);
  const selectCount = getExplorerSelectedCount({
    selectAllState,
    selectedIds: selectFileIds,
    total,
  });
  const hasSelected = selectAllState === 'all' || selectCount > 0;
  const batchTransferActions = useFileBatchTransferActions(selectCount);

  // If no libraryId, show category name or "Resource" for All
  const leftContent = hasSelected ? (
    <Flexbox horizontal align={'center'} gap={8} style={{ marginLeft: 0 }}>
      {libraryId ? (
        <ActionIcon
          disabled={!canEditResources}
          icon={BookMinusIcon}
          title={canEditResources ? t('FileManager.actions.removeFromLibrary') : reason}
          onClick={() => {
            if (!canEditResources) return;
            confirmModal({
              cancelText: t('cancel', { ns: 'common' }),
              content: t('FileManager.actions.confirmRemoveFromLibrary', {
                count: selectCount,
              }),
              okButtonProps: {
                danger: true,
              },
              okText: t('FileManager.actions.removeFromLibrary'),
              onOk: async () => {
                await onActionClick('removeFromKnowledgeBase');
                message.success(t('FileManager.actions.removeFromLibrarySuccess'));
              },
              title: t('FileManager.actions.removeFromLibrary'),
            });
          }}
        />
      ) : null}

      <ActionIcon
        disabled={!canEditResources}
        icon={FileBoxIcon}
        title={canEditResources ? t('FileManager.actions.batchChunking') : reason}
        onClick={async () => {
          if (!canEditResources) return;
          await onActionClick('batchChunking');
        }}
      />

      {batchTransferActions?.map((action) => (
        <ActionIcon
          disabled={!canEditResources}
          icon={action.icon}
          key={action.key}
          title={canEditResources ? action.label : reason}
          onClick={() => {
            if (!canEditResources) return;
            action.onClick();
          }}
        />
      ))}

      <ActionIcon
        disabled={!canEditResources}
        icon={Trash2Icon}
        title={canEditResources ? t('delete', { ns: 'common' }) : reason}
        onClick={() => {
          if (!canEditResources) return;
          confirmModal({
            cancelText: t('cancel', { ns: 'common' }),
            content: t(
              selectAllState === 'all'
                ? 'FileManager.actions.confirmDeleteAllFiles'
                : 'FileManager.actions.confirmDeleteMultiFiles',
              { count: selectCount },
            ),
            okButtonProps: {
              danger: true,
            },
            okText: t('delete', { ns: 'common' }),
            onOk: async () => {
              await onActionClick('delete');
              message.success(t('FileManager.actions.deleteSuccess'));
            },
            title: t('delete', { ns: 'common' }),
          });
        }}
      />
    </Flexbox>
  ) : !libraryId ? (
    <Flexbox style={{ marginLeft: 8 }}>
      {category === FilesTabs.All
        ? t('resource', { defaultValue: 'Resource' })
        : t(`tab.${category as FilesTabs}` as any, { ns: 'file' })}
    </Flexbox>
  ) : (
    <Flexbox style={{ marginLeft: 8 }}>
      <Breadcrumb category={category} knowledgeBaseId={libraryId} />
    </Flexbox>
  );

  return (
    <NavHeader
      left={leftContent}
      right={
        <>
          <SearchInput />
          <SortDropdown />
          <BatchActionsDropdown selectCount={selectCount} onActionClick={onActionClick} />
          <ViewSwitcher />
          <Flexbox style={{ marginLeft: 8 }}>
            <AddButton />
          </Flexbox>
        </>
      }
      style={{
        borderBottom: `1px solid ${cssVar.colorBorderSecondary}`,
      }}
    />
  );
});

export default Header;
