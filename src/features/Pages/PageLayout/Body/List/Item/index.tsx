import { HTML_DOCUMENT_FILE_TYPE } from '@lobechat/const';
import { Avatar, createStaticStyles, cssVar, Icon, Tooltip } from '@lobehub/ui';
import { FileTextIcon, GlobeIcon, LockIcon } from 'lucide-react';
import { type MouseEvent } from 'react';
import { memo, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { isDesktop } from '@/const/version';
import NavItem from '@/features/NavPanel/components/NavItem';
import { docsPagePath } from '@/features/ResourceHome/paths';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';
import { useElectronStore } from '@/store/electron';
import { pageActions, pageSelectors, usePageStore } from '@/store/page';

import Actions from './Actions';
import Editing from './Editing';
import { useDropdownMenu } from './useDropdownMenu';

// The lock sits right after the title instead of at the row's end: the end is
// where the hover actions overlay the row, which would hide the lock exactly
// when the pointer reaches it.
const styles = createStaticStyles(({ css }) => ({
  lock: css`
    flex: none;
  `,
  title: css`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  titleRow: css`
    display: inline-flex;
    gap: 4px;
    align-items: center;

    max-width: 100%;

    vertical-align: middle;
  `,
}));

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

  const addTab = useElectronStore((s) => s.addTab);
  const activeWorkspaceSlug = useActiveWorkspaceSlug();
  // Visibility only means something inside a workspace; personal pages are
  // always the owner's alone, so they never carry the lock.
  const isPrivate = Boolean(useActiveWorkspaceId()) && document?.visibility === 'private';

  const active = selectedPageId === pageId;
  const title = document?.title || t('pageList.untitled');
  const emoji = document?.metadata?.emoji;
  const isHtmlPage = document?.fileType === HTML_DOCUMENT_FILE_TYPE;

  const toggleEditing = useCallback(
    (visible?: boolean) => {
      pageActions.setRenamingPageId(visible ? pageId : null);
    },
    [pageId],
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
            pageActions.selectPage(pageId);
          }, 250);
        } else {
          pageActions.selectPage(pageId);
        }
      }
    },
    [editing, pageId],
  );

  const handleDoubleClick = useCallback(() => {
    if (!isDesktop) return;
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    addTab(buildWorkspaceAwarePath(docsPagePath(pageId), activeWorkspaceSlug));
    pageActions.selectPage(pageId);
  }, [pageId, activeWorkspaceSlug, addTab]);

  // Icon with emoji support; an HTML page reads as an artifact (the chat's HTML
  // artifact icon) rather than a text page.
  const icon = useMemo(() => {
    if (emoji) {
      return <Avatar avatar={emoji} size={28} />;
    }
    return (
      <Icon icon={isHtmlPage ? GlobeIcon : FileTextIcon} size={{ size: 18, strokeWidth: 1.5 }} />
    );
  }, [emoji, isHtmlPage]);

  const dropdownMenu = useDropdownMenu({ pageId, toggleEditing });

  return (
    <>
      <NavItem
        actions={<Actions dropdownMenu={dropdownMenu} />}
        active={active}
        className={className}
        contextMenuItems={dropdownMenu}
        disabled={editing}
        href={docsPagePath(pageId)}
        icon={icon}
        key={pageId}
        title={
          isPrivate ? (
            <span className={styles.titleRow}>
              <span className={styles.title}>{title}</span>
              <Tooltip title={t('pageList.privateTooltip')}>
                <Icon
                  aria-label={t('pageList.privateTooltip')}
                  className={styles.lock}
                  color={cssVar.colorTextDescription}
                  icon={LockIcon}
                  size={14}
                />
              </Tooltip>
            </span>
          ) : (
            title
          )
        }
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
