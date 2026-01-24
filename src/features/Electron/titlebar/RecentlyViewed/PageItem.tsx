'use client';

import { ActionIcon, Flexbox, Icon } from '@lobehub/ui';
import { cx } from 'antd-style';
import { Pin, PinOff } from 'lucide-react';
import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useElectronStore } from '@/store/electron';
import type { PageEntry } from '@/store/electron/actions/recentPages';

import { getRouteIcon } from '../../navigation/routeMetadata';
import { useStyles } from './styles';

interface PageItemProps {
  isPinned: boolean;
  item: PageEntry;
  onClose: () => void;
}

const PageItem = memo<PageItemProps>(({ item, isPinned, onClose }) => {
  const { t } = useTranslation('electron');
  const navigate = useNavigate();
  const styles = useStyles;

  const pinPage = useElectronStore((s) => s.pinPage);
  const unpinPage = useElectronStore((s) => s.unpinPage);

  const RouteIcon = getRouteIcon(item.url);

  const handleClick = () => {
    navigate(item.url);
    onClose();
  };

  const handlePinToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isPinned) {
      unpinPage(item.url);
    } else {
      pinPage({ title: item.title, url: item.url });
    }
  };

  return (
    <Flexbox align="center" className={styles.item} gap={8} horizontal onClick={handleClick}>
      {RouteIcon && <Icon className={styles.icon} icon={RouteIcon} size="small" />}
      <span className={styles.itemTitle}>{item.title}</span>
      <ActionIcon
        className={cx('actionIcon', styles.actionIcon)}
        icon={isPinned ? PinOff : Pin}
        onClick={handlePinToggle}
        size="small"
        title={isPinned ? t('navigation.unpin') : t('navigation.pin')}
      />
    </Flexbox>
  );
});

PageItem.displayName = 'PageItem';

export default PageItem;
