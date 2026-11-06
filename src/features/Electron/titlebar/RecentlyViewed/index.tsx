'use client';

import { Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveLocation } from '@/hooks/useActiveLocation';
import { useElectronStore } from '@/store/electron';

import { useResolvedPages } from './hooks/useResolvedPages';
import Section from './Section';
import { styles } from './styles';

interface RecentlyViewedProps {
  onClose: () => void;
}

const RecentlyViewed = memo<RecentlyViewedProps>(({ onClose }) => {
  const { t } = useTranslation('electron');
  const location = useActiveLocation();

  const loadPinnedPages = useElectronStore((s) => s.loadPinnedPages);

  const { pinnedPages, recentPages } = useResolvedPages();

  useEffect(() => {
    loadPinnedPages(location.pathname + location.search);
  }, [loadPinnedPages, location.pathname, location.search]);

  const isEmpty = pinnedPages.length === 0 && recentPages.length === 0;

  if (isEmpty) {
    return (
      <div {...stylex.props(styles.container)}>
        <div {...stylex.props(styles.empty)}>{t('navigation.noPages')}</div>
      </div>
    );
  }

  return (
    <Flexbox className={stylex.props(styles.container).className}>
      <Section isPinned items={pinnedPages} title={t('navigation.pinned')} onClose={onClose} />
      {pinnedPages.length > 0 && recentPages.length > 0 && (
        <div {...stylex.props(styles.divider)} />
      )}
      <Section
        isPinned={false}
        items={recentPages}
        title={t('navigation.recentView')}
        onClose={onClose}
      />
    </Flexbox>
  );
});

RecentlyViewed.displayName = 'RecentlyViewed';

export default RecentlyViewed;
