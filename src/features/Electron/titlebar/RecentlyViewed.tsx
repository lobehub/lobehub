'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useElectronStore } from '@/store/electron';
import type { HistoryEntry } from '@/store/electron/actions/navigationHistory';

import { getRouteIcon } from '../navigation/routeMetadata';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    overflow-y: auto;
    width: 260px;
    max-height: 320px;
    padding: 4px;
  `,
  empty: css`
    padding-block: 16px;
    padding-inline: 12px;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
    text-align: center;
  `,
  icon: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextSecondary};
  `,
  item: css`
    cursor: pointer;

    overflow: hidden;
    flex-shrink: 0;

    padding-block: 6px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadiusSM};

    transition: background-color 0.15s ${cssVar.motionEaseInOut};

    &:hover {
      background-color: ${cssVar.colorFillSecondary};
    }
  `,
  itemActive: css`
    background-color: ${cssVar.colorFillTertiary};
  `,
  itemTitle: css`
    overflow: hidden;
    flex: 1;

    font-size: 12px;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  title: css`
    padding-block: 4px;
    padding-inline: 8px;

    font-size: 11px;
    font-weight: 500;
    color: ${cssVar.colorTextTertiary};
    text-transform: uppercase;
    letter-spacing: 0.5px;
  `,
}));

interface RecentlyViewedProps {
  onClose: () => void;
}

const RecentlyViewed = memo<RecentlyViewedProps>(({ onClose }) => {
  const { t } = useTranslation('electron');
  const navigate = useNavigate();
  const historyEntries = useElectronStore((s) => s.historyEntries);
  const historyCurrentIndex = useElectronStore((s) => s.historyCurrentIndex);
  const setIsNavigatingHistory = useElectronStore((s) => s.setIsNavigatingHistory);

  const handleClick = (entry: HistoryEntry, index: number) => {
    // Set flag to prevent adding duplicate history entry
    setIsNavigatingHistory(true);

    // Update the current index in store
    useElectronStore.setState({ historyCurrentIndex: index });

    // Navigate to the selected entry
    navigate(entry.url);

    // Close the popover
    onClose();
  };

  // Show entries in reverse order (most recent first), excluding current
  const recentEntries = [...historyEntries]
    .map((entry, index) => ({ entry, originalIndex: index }))
    .reverse();

  if (recentEntries.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.empty}>{t('navigation.recentView')}</div>
      </div>
    );
  }

  return (
    <Flexbox className={styles.container}>
      <div className={styles.title}>{t('navigation.recentView')}</div>
      {recentEntries.map(({ entry, originalIndex }) => {
        const isActive = originalIndex === historyCurrentIndex;
        const RouteIcon = getRouteIcon(entry.url);

        return (
          <Flexbox
            align="center"
            className={`${styles.item} ${isActive ? styles.itemActive : ''}`}
            gap={8}
            horizontal
            key={`${entry.url}-${originalIndex}`}
            onClick={() => handleClick(entry, originalIndex)}
          >
            {RouteIcon && <Icon className={styles.icon} icon={RouteIcon} size="small" />}
            <span className={styles.itemTitle}>{entry.title}</span>
          </Flexbox>
        );
      })}
    </Flexbox>
  );
});

RecentlyViewed.displayName = 'RecentlyViewed';

export default RecentlyViewed;
