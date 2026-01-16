'use client';

import { ActionIcon, Avatar, DropdownMenu, Text } from '@lobehub/ui';
import { ArrowLeftIcon, MoreHorizontal } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import { AutoSaveHint } from '@/features/EditorCanvas';
import NavHeader from '@/features/NavHeader';
import ToggleRightPanelButton from '@/features/RightPanel/ToggleRightPanelButton';

import { usePageEditorStore } from '../store';
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
  const { menuItems } = useMenu();

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
          {/* Auto Save Status */}
          {documentId && <AutoSaveHint documentId={documentId} style={{ marginLeft: 6 }} />}
        </>
      }
      right={
        <>
          {/* Three-dot menu */}
          <DropdownMenu
            items={menuItems}
            nativeButton={false}
            placement="bottomRight"
            popupProps={{
              style: {
                minWidth: 200,
              },
            }}
          >
            <ActionIcon icon={MoreHorizontal} size={DESKTOP_HEADER_ICON_SIZE} />
          </DropdownMenu>
          <ToggleRightPanelButton hideWhenExpanded showActive={false} />
        </>
      }
    />
  );
});

export default Header;
