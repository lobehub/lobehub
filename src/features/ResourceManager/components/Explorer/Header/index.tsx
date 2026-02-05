'use client';

import { ActionIcon, Flexbox } from '@lobehub/ui';
import { App } from 'antd';
import { cssVar } from 'antd-style';
import { BookMinusIcon, FileBoxIcon, SearchIcon, Trash2Icon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useResourceManagerStore } from '@/app/[variants]/(main)/resource/features/store';
import NavHeader from '@/features/NavHeader';
import { useGlobalStore } from '@/store/global';
import { FilesTabs } from '@/types/files';

import AddButton from '../../Header/AddButton';
import BatchActionsDropdown from '../ToolBar/BatchActionsDropdown';
import SortDropdown from '../ToolBar/SortDropdown';
import ViewSwitcher from '../ToolBar/ViewSwitcher';
import Breadcrumb from './Breadcrumb';

/**
 * Toolbar for the resource explorer
 */
const Header = memo(() => {
  const { t } = useTranslation(['components', 'common', 'file', 'knowledgeBase']);
  const { modal, message } = App.useApp();

  // Get state and actions from store
  const [libraryId, category, onActionClick, selectFileIds] = useResourceManagerStore((s) => [
    s.libraryId,
    s.category,
    s.onActionClick,
    s.selectedFileIds,
  ]);
  const toggleCommandMenu = useGlobalStore((s) => s.toggleCommandMenu);

  const selectCount = selectFileIds.length;
  const isMultiSelected = selectCount > 1;

  // If no libraryId, show category name or "Resource" for All
  const leftContent = isMultiSelected ? (
    <Flexbox horizontal align={'center'} gap={8} style={{ marginLeft: 0 }}>
      {libraryId ? (
        <ActionIcon
          icon={BookMinusIcon}
          title={t('FileManager.actions.removeFromLibrary')}
          onClick={() => {
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
          }}
        />
      ) : null}

      <ActionIcon
        icon={FileBoxIcon}
        title={t('FileManager.actions.batchChunking')}
        onClick={async () => {
          await onActionClick('batchChunking');
        }}
      />

      <ActionIcon
        icon={Trash2Icon}
        title={t('delete', { ns: 'common' })}
        onClick={() => {
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
          <ActionIcon icon={SearchIcon} onClick={() => toggleCommandMenu(true)} />
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
