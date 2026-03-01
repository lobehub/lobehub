import { Avatar, Icon } from '@lobehub/ui';
import { FileTextIcon } from 'lucide-react';
import { type MouseEvent } from 'react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import NavItem from '@/features/NavPanel/components/NavItem';
import { pageSelectors, usePageStore } from '@/store/page';

import Actions from './Actions';
import Editing from './Editing';
import { useDropdownMenu } from './useDropdownMenu';

interface DocumentItemProps {
  className?: string;
  pageId: string;
}

const PageListItem = memo<DocumentItemProps>(({ pageId, className }) => {
  const { t } = useTranslation('file');
  const [editing, selectedPageId, document] = usePageStore((s) => {
    const doc = pageSelectors.getDocumentById(pageId)(s);
    return [s.renamingPageId === pageId, s.selectedPageId, doc] as const;
  });

  const selectPage = usePageStore((s) => s.selectPage);
  const setRenamingPageId = usePageStore((s) => s.setRenamingPageId);

  const active = selectedPageId === pageId;
  const title = document?.title || t('pageList.untitled');
  const emoji = document?.metadata?.emoji;

  const toggleEditing = useCallback(
    (visible?: boolean) => {
      setRenamingPageId(visible ? pageId : null);
    },
    [pageId, setRenamingPageId],
  );

  const handleClick = useCallback(
    (e: MouseEvent) => {
      // Skip navigation in current tab when opening in new tab
      if (e.metaKey || e.ctrlKey) return;
      if (!editing) {
        selectPage(pageId);
      }
    },
    [editing, selectPage, pageId],
  );

  // Icon with emoji support
  const icon = useMemo(() => {
    if (emoji) {
      return <Avatar avatar={emoji} size={28} />;
    }
    return <Icon icon={FileTextIcon} size={{ size: 18, strokeWidth: 1.5 }} />;
  }, [emoji]);

  const dropdownMenu = useDropdownMenu({ pageId, toggleEditing });

  return (
    <>
      <NavItem
        actions={<Actions dropdownMenu={dropdownMenu} />}
        active={active}
        className={className}
        contextMenuItems={dropdownMenu}
        disabled={editing}
        href={`/page/${pageId}`}
        icon={icon}
        key={pageId}
        title={title}
        onClick={handleClick}
      />
      <Editing
        currentEmoji={emoji}
        documentId={pageId}
        title={title}
        toggleEditing={toggleEditing}
      />
    </>
  );
});

export default PageListItem;
