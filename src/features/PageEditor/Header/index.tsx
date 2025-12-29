'use client';

import { ActionIcon, Avatar, Dropdown, Skeleton, Text } from '@lobehub/ui';
import { ArrowLeftIcon, BotMessageSquareIcon, MoreHorizontal } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import NavHeader from '@/features/NavHeader';
import ToggleRightPanelButton from '@/features/RightPanel/ToggleRightPanelButton';

import { usePageEditorStore } from '../store';
import AutoSaveHint from './AutoSaveHint';
import Breadcrumb from './Breadcrumb';
import { useMenu } from './useMenu';

const Header = memo(() => {
  const { t } = useTranslation('file');
  const [currentEmoji, currentTitle, isLoadingContent, parentId, onBack] = usePageEditorStore(
    (s) => [s.currentEmoji, s.currentTitle, s.isLoadingContent, s.parentId, s.onBack],
  );
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
              {currentEmoji && <Avatar avatar={currentEmoji} shape={'square'} size={28} />}
              {/* Title */}
              {isLoadingContent ? (
                <Skeleton.Button
                  active
                  style={{ height: 20, marginLeft: 4, maxWidth: 200, width: 200 }}
                />
              ) : (
                <Text ellipsis style={{ marginLeft: 4 }} weight={500}>
                  {currentTitle || t('pageEditor.titlePlaceholder')}
                </Text>
              )}
            </>
          )}
          {/* Auto Save Status - hide while loading */}
          {!isLoadingContent && <AutoSaveHint />}
        </>
      }
      right={
        <>
          <ToggleRightPanelButton icon={BotMessageSquareIcon} showActive={true} />
          {/* Three-dot menu */}
          <Dropdown
            menu={{
              items: menuItems,
              style: { minWidth: 200 },
            }}
            placement="bottomRight"
            trigger={['click']}
          >
            <ActionIcon icon={MoreHorizontal} size={DESKTOP_HEADER_ICON_SIZE} />
          </Dropdown>
        </>
      }
    />
  );
});

export default Header;
