'use client';

import { Block, Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import type { ReactNode } from 'react';

import WideScreenContainer from '@/features/WideScreenContainer';
import type { RouteSkeletonProps } from '@/spa/router/routeMeta';

import SkeletonBar from './Bar';

const styles = createStaticStyles(({ css }) => ({
  header: css`
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  notice: css`
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillQuaternary};
  `,
}));

/** Breadcrumb on the left, the profile tab switcher centred — same as `NavHeader` on the page. */
const NavigationSkeleton = () => (
  <Flexbox
    horizontal
    align={'center'}
    className={styles.header}
    flex={'none'}
    height={44}
    paddingInline={16}
    style={{ position: 'relative' }}
  >
    <Flexbox horizontal align={'center'} gap={8}>
      <SkeletonBar height={20} radius={'50%'} width={20} />
      <SkeletonBar height={14} width={120} />
    </Flexbox>
    {/* Mirrors `AGENT_PROFILE_TABS_CENTER_STYLE`: centred on the header midpoint. */}
    <Flexbox style={{ left: '50%', position: 'absolute', transform: 'translateX(-50%)' }}>
      <SkeletonBar height={28} radius={14} width={280} />
    </Flexbox>
  </Flexbox>
);

const SettingRowSkeleton = ({ control, index }: { control: 'switch' | 'input'; index: number }) => (
  <Flexbox horizontal align={'center'} gap={16} justify={'space-between'}>
    <Flexbox gap={6}>
      <SkeletonBar height={14} width={96 + (index % 3) * 28} />
      <SkeletonBar height={12} width={200 + (index % 2) * 48} />
    </Flexbox>
    {control === 'switch' ? (
      <SkeletonBar height={22} radius={11} width={44} />
    ) : (
      <SkeletonBar height={32} width={120} />
    )}
  </Flexbox>
);

const SectionSkeleton = ({
  children,
  descWidth = 260,
  titleWidth,
}: {
  children: ReactNode;
  descWidth?: number;
  titleWidth: number;
}) => (
  <Block gap={16} padding={20} variant={'outlined'}>
    <Flexbox gap={6}>
      <SkeletonBar height={16} width={titleWidth} />
      <SkeletonBar height={12} width={descWidth} />
    </Flexbox>
    {children}
  </Block>
);

/**
 * Body of the share settings page: the warning notice, then the outlined
 * sections (`Section` in `AgentShareSettings/SectionLayout.tsx`) — link,
 * usage stats, permissions, limits. Reused by the page's own data-loading
 * state so the layout does not jump between route load and share fetch.
 */
export const AgentShareSettingsBodySkeleton = () => (
  <Flexbox aria-busy gap={16} paddingBlock={16}>
    <Flexbox
      horizontal
      align={'flex-start'}
      className={styles.notice}
      gap={12}
      padding={'12px 16px'}
    >
      <SkeletonBar height={18} radius={'50%'} width={18} />
      <Flexbox flex={1} gap={8}>
        <SkeletonBar height={14} width={160} />
        <SkeletonBar height={12} width={'82%'} />
      </Flexbox>
    </Flexbox>
    <SectionSkeleton titleWidth={88}>
      <SettingRowSkeleton control={'switch'} index={0} />
      <SkeletonBar height={36} width={'100%'} />
    </SectionSkeleton>
    <SectionSkeleton descWidth={200} titleWidth={72}>
      <Flexbox horizontal gap={16}>
        {Array.from({ length: 3 }).map((_, index) => (
          <Flexbox flex={1} gap={8} key={index}>
            <SkeletonBar height={12} width={64} />
            <SkeletonBar height={24} width={48 + index * 12} />
          </Flexbox>
        ))}
      </Flexbox>
    </SectionSkeleton>
    <SectionSkeleton titleWidth={104}>
      <SettingRowSkeleton control={'switch'} index={1} />
      <SettingRowSkeleton control={'switch'} index={2} />
    </SectionSkeleton>
    <SectionSkeleton titleWidth={80}>
      <SettingRowSkeleton control={'input'} index={3} />
      <SettingRowSkeleton control={'input'} index={4} />
    </SectionSkeleton>
  </Flexbox>
);

/** Route-level skeleton for `/agent/:aid/share` (see `agentShareRouteMeta`). */
const AgentShareSkeleton = ({ chrome = 'page' }: RouteSkeletonProps) => (
  <Flexbox aria-busy flex={1} height={'100%'} style={{ minHeight: 0, overflow: 'hidden' }}>
    {chrome !== 'body' && <NavigationSkeleton />}
    <Flexbox flex={1} style={{ minHeight: 0, overflow: 'hidden' }}>
      <WideScreenContainer>
        <AgentShareSettingsBodySkeleton />
      </WideScreenContainer>
    </Flexbox>
  </Flexbox>
);

export default AgentShareSkeleton;
