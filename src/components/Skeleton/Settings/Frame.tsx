'use client';

import { Flexbox, Text } from '@lobehub/ui';
import type { ReactNode } from 'react';

import NavHeader from '@/features/NavHeader';
import SettingContainer from '@/features/Setting/SettingContainer';
import { getSettingsContainerMaxWidth } from '@/features/Settings/features/ownFrameTabs';
import { SettingsPageActionsRow } from '@/features/Settings/features/SettingsPageActions';
import { useSettingsTabTitle } from '@/features/Settings/features/tabTitles';

import SkeletonBar from '../Bar';

/**
 * The shared settings navigation header in its loading state. The title is
 * static copy, so it renders as the same text the settled header shows.
 */
export const SettingsSkeletonHeader = ({ tab }: { tab: string }) => {
  const title = useSettingsTabTitle(tab);

  return (
    <NavHeader styles={{ center: { alignItems: 'center' } }}>
      {title ? <Text weight={500}>{title}</Text> : <SkeletonBar height={16} width={88} />}
    </NavHeader>
  );
};

/**
 * Same header + padded container (1024px, or full width for `FULL_WIDTH_TABS`)
 * `SettingsContent` draws around a tab body, with the page-action placeholders
 * in the same row at the top of the content column.
 */
export const SettingsSkeletonFrame = ({
  actions,
  children,
  tab,
}: {
  actions?: ReactNode;
  children: ReactNode;
  tab: string;
}) => (
  <Flexbox aria-busy flex={1} height={'100%'} style={{ minHeight: 0, overflow: 'hidden' }}>
    <SettingsSkeletonHeader tab={tab} />
    <SettingContainer
      maxWidth={getSettingsContainerMaxWidth(tab)}
      paddingBlock={'24px 128px'}
      paddingInline={24}
    >
      {actions && <SettingsPageActionsRow>{actions}</SettingsPageActionsRow>}
      {children}
    </SettingContainer>
  </Flexbox>
);
