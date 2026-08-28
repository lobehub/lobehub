'use client';

import { Flexbox } from '@lobehub/ui';
import { ActionIcon, confirmModal, toast } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { BookMinusIcon, FileBoxIcon, Trash2Icon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useFileBatchTransferActions } from '@/business/client/hooks/useFileBatchTransferActions';
import { useIsWorkspaceOwner } from '@/business/client/hooks/useIsWorkspaceOwner';
import NavHeader from '@/features/NavHeader';
import { useResourceManagerStore } from '@/features/ResourceManager/store';
import { getExplorerSelectedCount } from '@/features/ResourceManager/store/selectors';
import { openWorkspaceDeleteAllModal } from '@/features/WorkspaceDeleteAllModal';
import { usePermission } from '@/hooks/usePermission';
import { useFileStore } from '@/store/file';
import { FilesTabs } from '@/types/files';

import AddButton from '../../Header/AddButton';
import BatchActionsDropdown from '../ToolBar/BatchActionsDropdown';
import SortDropdown from '../ToolBar/SortDropdown';
import SourceFilter from '../ToolBar/SourceFilter';
import ViewSwitcher from '../ToolBar/ViewSwitcher';
import Breadcrumb from './Breadcrumb';
import SearchInput from './SearchInput';

/**
 * Toolbar for the resource explorer
 */
const Header = memo(() => {
  const { t } = useTranslation(['components', 'common', 'file', 'knowledgeBase']);

  const activeWorkspaceId = useActiveWorkspaceId();

  // Get state and actions from store
  const [
    libraryId,
    category,
    onActionClick,
    selectAllState,
    selectFileIds,
    selectionTotal,
    viewMode,
  ] = useResourceManagerStore((s) => [
    s.libraryId,
    s.category,
    s.onActionClick,
    s.selectAllState,
    s.selectedFileIds,
    s.selectionTotal,
    s.viewMode,
  ]);
  const isWorkspaceOwner = useIsWorkspaceOwner();
  const { allowed: canEditResources, reason } = usePermission('edit_own_content');
  const total = useFileStore((s) => s.total);
  const selectCount = getExplorerSelectedCount({
    selectAllState,
    selectedIds: selectFileIds,
    total: selectionTotal ?? total,
  });
  const hasSelected = selectAllState === 'all' || selectCount > 0;
  const isWorkspaceDeleteAll = !!activeWorkspaceId && selectAllState === 'all';
  const isWorkspaceOwnerDeleteAll = isWorkspaceDeleteAll && isWorkspaceOwner;
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
                toast.success(t('FileManager.actions.removeFromLibrarySuccess'));
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
        title={
          canEditResources
            ? t(
                isWorkspaceOwnerDeleteAll
                  ? 'FileManager.actions.deleteAll'
                  : isWorkspaceDeleteAll
                    ? 'FileManager.actions.deleteAllOwn'
                    : 'delete',
                {
                  ns: isWorkspaceDeleteAll ? 'components' : 'common',
                },
              )
            : reason
        }
        onClick={() => {
          if (!canEditResources) return;

          const handleDelete = async () => {
            await onActionClick('delete');
            toast.success(t('FileManager.actions.deleteSuccess'));
          };

          if (isWorkspaceOwnerDeleteAll) {
            openWorkspaceDeleteAllModal({
              acknowledgeText: t('FileManager.actions.confirmDeleteAllWorkspaceAcknowledge'),
              cancelText: t('cancel', { ns: 'common' }),
              confirmText: t('FileManager.actions.deleteAll'),
              description: t('FileManager.actions.confirmDeleteAllWorkspaceFiles'),
              onConfirm: handleDelete,
              title: t('FileManager.actions.deleteAll'),
            });
            return;
          }

          confirmModal({
            cancelText: t('cancel', { ns: 'common' }),
            content: t(
              selectAllState === 'all'
                ? isWorkspaceDeleteAll
                  ? 'FileManager.actions.confirmDeleteAllOwnFiles'
                  : 'FileManager.actions.confirmDeleteAllFiles'
                : 'FileManager.actions.confirmDeleteMultiFiles',
              { count: selectCount },
            ),
            okButtonProps: {
              danger: true,
            },
            okText: t('delete', { ns: 'common' }),
            onOk: async () => {
              await handleDelete();
            },
            title: t('delete', { ns: 'common' }),
          });
        }}
      />
    </Flexbox>
  ) : !libraryId ? (
    <Flexbox style={{ marginLeft: 8 }}>
      {category === FilesTabs.All
        ? t('resource', { ns: 'file' })
        : t(`tab.${category as FilesTabs}` as any, { ns: 'file' })}
    </Flexbox>
  ) : (
    <Flexbox horizontal align={'center'} gap={4} style={{ marginLeft: 8 }}>
      <Breadcrumb category={category} knowledgeBaseId={libraryId} />
    </Flexbox>
  );

  return (
    <NavHeader
      left={leftContent}
      right={
        <>
          {/*
            Grid view carries the source chips on its item-count row (where the
            count and the pool it counts belong together). The list view has no
            such row — its header is a horizontally scrolling column strip — so
            the chips live here instead, and a standing filter stays visible in
            both views.
          */}
          {viewMode === 'list' && <SourceFilter />}
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
