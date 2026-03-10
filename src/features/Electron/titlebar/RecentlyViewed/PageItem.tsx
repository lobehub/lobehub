'use client';

import { ActionIcon, Flexbox, Icon } from '@lobehub/ui';
import { cx } from 'antd-style';
import { Pin, PinOff } from 'lucide-react';
import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';

import { useElectronStore } from '@/store/electron';

import { useStyles } from './styles';
import { type ResolvedPageData } from './types';

interface PageItemProps {
  isPinned: boolean;
  item: ResolvedPageData;
  onClose: () => void;
}

const PageItem = memo<PageItemProps>(({ item, isPinned, onClose }) => {
  const { t } = useTranslation('electron');
  const navigate = useNavigate();
  const location = useLocation();
  const styles = useStyles;

  const pinPage = useElectronStore((s) => s.pinPage);
  const unpinPage = useElectronStore((s) => s.unpinPage);

  // Check if this item matches the current route
  const currentUrl = location.pathname + location.search;
  const isActive = item.url === currentUrl || item.url === currentUrl.replace(/\/+$/, '');

  const handleClick = () => {
    navigate(item.url);
    onClose();
  };

  const handlePinToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isPinned) {
      unpinPage(item.reference.id);
    } else {
      pinPage(item.reference);
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
      {item.icon && <Icon className={styles.icon} icon={item.icon} size="small" />}
      <span className={styles.itemTitle}>{item.title}</span>
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
