'use client';

import { ActionIcon, Avatar, DropdownMenu, Text } from '@lobehub/ui';
import { ArrowLeftIcon, MoreHorizontal } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import ShareButton from '@/business/client/features/PageShare/ShareButton';
import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import { AutoSaveHint } from '@/features/EditorCanvas';
import NavHeader from '@/features/NavHeader';
import ToggleRightPanelButton from '@/features/RightPanel/ToggleRightPanelButton';
import { usePermission } from '@/hooks/usePermission';

import EditingIndicator from '../EditingIndicator';
import { usePageAgentPanelControl } from '../RightPanel/OverrideContext';
import { selectors, usePageEditorStore } from '../store';
import Breadcrumb from './Breadcrumb';
import { useMenu } from './useMenu';

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
          {canExpandRightPanel && (
            <ToggleRightPanelButton
              hideWhenExpanded
              expand={showPageAgentPanel}
              showActive={false}
              onToggle={() => togglePageAgentPanel()}
            />
          )}
        </>
      }
    />
  );
});

export default Header;
