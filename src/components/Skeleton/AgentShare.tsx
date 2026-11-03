'use client';

import { Block, Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';

import WideScreenContainer from '@/features/WideScreenContainer';
import type { RouteSkeletonProps } from '@/spa/router/routeMeta';

import AgentProfileNavSkeleton from './AgentProfileNav';
import SkeletonBar from './Bar';

const styles = stylex.create({
  notice: {
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  tabs: {
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorder,
  },
});

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
 * Body of the share settings page: the warning notice, the link card, the
 * access/stats tab strip, then the outlined sections of the default (access)
 * tab — permissions and limits (`Section` in
 * `AgentShareSettings/SectionLayout.tsx`). Reused by the page's own
 * data-loading state so the layout does not jump between route load and share
 * fetch.
 */
export const AgentShareSettingsBodySkeleton = () => (
  <Flexbox aria-busy gap={16} paddingBlock={16}>
    <Flexbox
      horizontal
      align={'flex-start'}
      className={stylex.props(styles.notice).className}
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
    {/* Mirrors `ShareTabs`: two underline tabs on a hairline. */}
    <Flexbox horizontal className={stylex.props(styles.tabs).className} gap={24} paddingBlock={10}>
      <SkeletonBar height={14} width={64} />
      <SkeletonBar height={14} width={64} />
    </Flexbox>
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
    {chrome !== 'body' && <AgentProfileNavSkeleton />}
    <Flexbox flex={1} style={{ minHeight: 0, overflow: 'hidden' }}>
      <WideScreenContainer>
        <AgentShareSettingsBodySkeleton />
      </WideScreenContainer>
    </Flexbox>
  </Flexbox>
);

export default AgentShareSkeleton;
