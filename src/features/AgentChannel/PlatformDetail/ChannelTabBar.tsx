'use client';

import { Tabs } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ChannelTab } from './channelTabs';

const styles = stylex.create({
  dot: {
    backgroundColor: cssVar.colorWarning,
    borderRadius: '50%',
    display: 'inline-block',
    height: 6,
    marginInlineStart: 6,
    verticalAlign: 'middle',
    width: 6,
  },
  pending: {
    backgroundColor: cssVar.colorPrimary,
    borderRadius: '50%',
    display: 'inline-block',
    height: 6,
    marginInlineStart: 6,
    verticalAlign: 'middle',
    width: 6,
  },
});

interface ChannelTabBarProps {
  active: ChannelTab;
  /** Tabs that still need something fixed get a small dot. */
  issues: ChannelTab[];
  onChange: (tab: ChannelTab) => void;
  /** Tabs with a change that is not saved yet get a dot of their own: leaving the tab keeps it. */
  pending?: ChannelTab[];
  tabs: ChannelTab[];
}

export const ChannelTabBar = memo<ChannelTabBarProps>(
  ({ active, issues, onChange, pending = [], tabs }) => {
    const { t: _t } = useTranslation('agent');
    const t = _t as (key: string) => string;

    return (
      <Tabs
        activeKey={active}
        items={tabs.map((tab) => ({
          key: tab,
          label: (
            <span>
              {t(`channel.tab.${tab}`)}
              {issues.includes(tab) && <i {...stylex.props(styles.dot)} />}
              {pending.includes(tab) && (
                <i
                  {...stylex.props(styles.pending)}
                  aria-label={t('channel.tab.unsaved')}
                  role={'img'}
                  title={t('channel.tab.unsaved')}
                />
              )}
            </span>
          ),
        }))}
        onChange={(key) => onChange(key as ChannelTab)}
      />
    );
  },
);

ChannelTabBar.displayName = 'ChannelTabBar';
