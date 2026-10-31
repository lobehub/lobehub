'use client';

import { ActionIcon, Flexbox, Icon } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { Pin, PinOff } from 'lucide-react';
import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useActiveLocation } from '@/hooks/useActiveLocation';
import { useElectronStore } from '@/store/electron';

import { type ResolvedTab } from '../TabBar/hooks/useResolvedTabs';
import { isSameTabTarget } from '../TabBar/scope';
import { styles } from './styles';

interface PageItemProps {
  isPinned: boolean;
  item: ResolvedTab;
  onClose: () => void;
}

const PageItem = memo<PageItemProps>(({ item, isPinned, onClose }) => {
  const { t } = useTranslation('electron');
  const navigate = useWorkspaceAwareNavigate();
  const location = useActiveLocation();

  const pinPage = useElectronStore((s) => s.pinPage);
  const unpinPage = useElectronStore((s) => s.unpinPage);

  const { meta, tab } = item;
  const currentUrl = location.pathname + location.search;
  const isActive = isSameTabTarget(tab, currentUrl);

  const handleClick = () => {
    navigate(tab.url, { escape: true });
    onClose();
  };

  const handlePinToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isPinned) {
      unpinPage(tab.id);
    } else {
      pinPage(tab);
    }
  };

  return (
    <Flexbox
      horizontal
      align="center"
      gap={8}
      className={
        stylex.props(styles.item, isActive && styles.itemActive, stylex.defaultMarker()).className
      }
      onClick={handleClick}
    >
      {meta.icon && (
        <Icon className={stylex.props(styles.icon).className} icon={meta.icon} size="small" />
      )}
      <span {...stylex.props(styles.itemTitle)}>{meta.title}</span>
      <ActionIcon
        className={stylex.props(styles.actionIcon).className}
        icon={isPinned ? PinOff : Pin}
        size="small"
        title={isPinned ? t('navigation.unpin') : t('navigation.pin')}
        onClick={handlePinToggle}
      />
    </Flexbox>
  );
});

PageItem.displayName = 'PageItem';

export default PageItem;
