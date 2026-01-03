'use client';

import { ActionIcon, Flexbox } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { SearchIcon } from 'lucide-react';
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

const Header = memo(() => {
  const { t } = useTranslation('file');

  // Get state and actions from store
  const [libraryId, category, onActionClick, selectFileIds] = useResourceManagerStore((s) => [
    s.libraryId,
    s.category,
    s.onActionClick,
    s.selectedFileIds,
  ]);
  const toggleCommandMenu = useGlobalStore((s) => s.toggleCommandMenu);

  // Disable batch actions dropdown when no items selected and not in any library
  const isBatchActionsDisabled = selectFileIds.length === 0 && !libraryId;

  // If no libraryId, show just the category name
  const leftContent =
    !libraryId && category && category !== FilesTabs.All ? (
      <Flexbox style={{ marginLeft: 8 }}>{t(`tab.${category as FilesTabs}` as any)}</Flexbox>
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
          <BatchActionsDropdown
            disabled={isBatchActionsDisabled}
            onActionClick={onActionClick}
            selectCount={selectFileIds.length}
          />
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
