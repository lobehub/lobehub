'use client';

import { DropdownMenu, Flexbox } from '@lobehub/ui';
import { ActionIcon, Avatar, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ArrowLeftIcon, MessageSquareTextIcon, MoreHorizontal, SparklesIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import ShareButton from '@/business/client/features/PageShare/ShareButton';
import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import { AutoSaveHint } from '@/features/EditorCanvas';
import NavHeader from '@/features/NavHeader';
import ToggleRightPanelButton from '@/features/RightPanel/ToggleRightPanelButton';
import { usePermission } from '@/hooks/usePermission';

import { useDocumentComments } from '../DocumentComments/context';
import EditingIndicator from '../EditingIndicator';
import { usePageAgentPanelControl } from '../RightPanel/OverrideContext';
import { selectors, usePageEditorStore } from '../store';
import Breadcrumb from './Breadcrumb';
import { useMenu } from './useMenu';

const styles = createStaticStyles(({ css }) => ({
  /** The two sidebars share one segmented switch; the lit segment is the open one. */
  panelSwitch: css`
    padding: 2px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};
  `,
}));

const Header = memo(() => {
  const { t } = useTranslation('file');
  const [documentId, emoji, title, parentId, onBack] = usePageEditorStore((s) => [
    s.documentId,
    s.emoji,
    s.title,
    s.parentId,
    s.onBack,
  ]);
  const rightPanelMode = usePageEditorStore(selectors.rightPanelMode);
  const { allowed: hasEditPermission } = usePermission('edit_own_content');
  const { expand: showPageAgentPanel, toggle: togglePageAgentPanel } = usePageAgentPanelControl();
  const { menuItems } = useMenu();
  // Mirror the gate inside PageEditor/RightPanel: copilot is a document-editing
  // surface, so viewers can't open it; History is read-only and stays available
  // to everyone. Without this guard the button toggles the store, then disappears
  // via `hideWhenExpanded` while the panel refuses to open — a no-op control.
  const canExpandRightPanel = hasEditPermission || rightPanelMode === 'history';
  // Comments exist only for workspace documents with a comments panel to show
  // them in; the provider is absent otherwise.
  const comments = useDocumentComments();
  const [isCommentsPanelOpen, setCommentsPanelOpen] = usePageEditorStore((s) => [
    s.commentsPanelOpen,
    s.setCommentsPanelOpen,
  ]);

  return (
    <NavHeader
      left={
        <>
          {onBack && <ActionIcon icon={ArrowLeftIcon} onClick={onBack} />}
          {/* Breadcrumb - show when page has a parent folder */}
          {parentId && <Breadcrumb />}
          {/* Show icon and title only when there's no parent folder */}
          {!parentId && (
            <>
              {/* Icon */}
              {emoji && <Avatar avatar={emoji} shape={'square'} size={28} />}
              {/* Title */}
              <Text ellipsis style={{ marginLeft: 4 }} weight={500}>
                {title || t('pageEditor.titlePlaceholder')}
              </Text>
            </>
          )}
          {documentId && <AutoSaveHint documentId={documentId} style={{ marginLeft: 6 }} />}
        </>
      }
      right={
        <>
          <EditingIndicator />
          {documentId && <ShareButton documentId={documentId} />}
          {/* Three-dot menu */}
          <DropdownMenu
            iconSpaceMode="group"
            items={menuItems}
            placement="bottomRight"
            popupProps={{
              style: {
                minWidth: 200,
              },
            }}
          >
            <ActionIcon icon={MoreHorizontal} size={DESKTOP_HEADER_ICON_SMALL_SIZE} />
          </DropdownMenu>
          {(comments?.panelAvailable || canExpandRightPanel) && (
            // The framed segment control only earns its frame with two
            // segments; a lone toggle (a personal page has no comments, a
            // viewer has no copilot) stays a plain icon.
            <Flexbox
              horizontal
              gap={2}
              className={
                comments?.panelAvailable && canExpandRightPanel ? styles.panelSwitch : undefined
              }
            >
              {comments?.panelAvailable && (
                <ActionIcon
                  active={isCommentsPanelOpen}
                  icon={MessageSquareTextIcon}
                  size={DESKTOP_HEADER_ICON_SMALL_SIZE}
                  title={t('pageEditor.comments.toggle')}
                  onClick={() => setCommentsPanelOpen(!isCommentsPanelOpen)}
                />
              )}
              {canExpandRightPanel && (
                <ToggleRightPanelButton
                  showActive
                  expand={showPageAgentPanel}
                  icon={SparklesIcon}
                  title={t('pageEditor.copilot.toggle')}
                  onToggle={() => togglePageAgentPanel()}
                />
              )}
            </Flexbox>
          )}
        </>
      }
    />
  );
});

export default Header;
