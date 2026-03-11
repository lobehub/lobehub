import { Avatar, Icon } from '@lobehub/ui';
import { FileTextIcon } from 'lucide-react';
import { type MouseEvent } from 'react';
import { memo, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { isDesktop } from '@/const/version';
import { pluginRegistry } from '@/features/Electron/titlebar/RecentlyViewed/plugins';
import NavItem from '@/features/NavPanel/components/NavItem';
import { useElectronStore } from '@/store/electron';
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
  const addTab = useElectronStore((s) => s.addTab);

  const active = selectedPageId === pageId;
  const title = document?.title || t('pageList.untitled');
  const emoji = document?.metadata?.emoji;

  const toggleEditing = useCallback(
    (visible?: boolean) => {
      setRenamingPageId(visible ? pageId : null);
    },
    [pageId, setRenamingPageId],
  );

  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClick = useCallback(
    (e: MouseEvent) => {
      // Skip navigation in current tab when opening in new tab
      if (e.metaKey || e.ctrlKey) return;
      if (!editing) {
        if (isDesktop) {
          clickTimerRef.current = setTimeout(() => {
            clickTimerRef.current = null;
            selectPage(pageId);
          }, 250);
        } else {
          selectPage(pageId);
        }
      }
    },
    [editing, selectPage, pageId],
  );

  const handleDoubleClick = useCallback(() => {
    if (!isDesktop) return;
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    const reference = pluginRegistry.parseUrl(`/page/${pageId}`, '');
    if (reference) {
      addTab(reference);
      selectPage(pageId);
    }
  }, [pageId, addTab, selectPage]);

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
        onDoubleClick={handleDoubleClick}
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
