'use client';

import { ActionIcon, Flexbox, Icon } from '@lobehub/ui';
import { cx } from 'antd-style';
import { Pin, PinOff } from 'lucide-react';
import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useElectronStore } from '@/store/electron';

import { type ResolvedTab } from '../TabBar/hooks/useResolvedTabs';
import { normalizeTabUrl } from '../TabBar/url';
import { useStyles } from './styles';

interface PageItemProps {
  isPinned: boolean;
  item: ResolvedTab;
  onClose: () => void;
}

const PageItem = memo<PageItemProps>(({ item, isPinned, onClose }) => {
  const { t } = useTranslation('electron');
  const navigate = useWorkspaceAwareNavigate();
  const location = useLocation();
  const styles = useStyles;

  const pinPage = useElectronStore((s) => s.pinPage);
  const unpinPage = useElectronStore((s) => s.unpinPage);

  const { meta, tab } = item;
  const currentId = normalizeTabUrl(location.pathname + location.search);
  const isActive = tab.id === currentId;

  const handleClick = () => {
    navigate(tab.url);
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
      className={cx(styles.item, isActive && styles.itemActive)}
      gap={8}
      onClick={handleClick}
    >
      {meta.icon && <Icon className={styles.icon} icon={meta.icon} size="small" />}
      <span className={styles.itemTitle}>{meta.title}</span>
      <ActionIcon
        className={cx('actionIcon', styles.actionIcon)}
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
