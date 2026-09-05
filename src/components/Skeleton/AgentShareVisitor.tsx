'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';

import { ProductLogo } from '@/components/Branding';
import { useIsMobile } from '@/hooks/useIsMobile';

import SkeletonBar from './Bar';
import ConversationSegmentSkeleton from './Conversation/Segment';

/** Mirrors `SIDEBAR_WIDTH` of `AgentShareVisitor/Page`. */
const SIDEBAR_WIDTH = 260;

const styles = createStaticStyles(({ css }) => ({
  header: css`
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  sidebar: css`
    border-inline-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  topBar: css`
    flex: none;
    block-size: 48px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    background: ${cssVar.colorBgLayout};
  `,
}));

/**
 * Skeleton of the agent-share visitor page (`/a/:slugOrId`): the product bar
 * on top, the topic list on the left, the shared agent's header row and
 * conversation on the right.
 *
 * The real logo is drawn rather than a placeholder bar: it needs no data, and
 * a visitor arriving from a link should see whose product this is from the
 * very first frame. Everything that depends on the share (agent name, topics,
 * messages) is a bar.
 *
 * Used at every step of the visitor's arrival — the chunk load and the share
 * fetch — so the page does not swap skeleton shapes on the way in.
 */
const AgentShareVisitorSkeleton = () => {
  const isMobile = useIsMobile();

  return (
    <Flexbox aria-busy height={'100%'} style={{ overflow: 'hidden' }} width={'100%'}>
      <Flexbox
        horizontal
        align={'center'}
        className={styles.topBar}
        justify={'space-between'}
        paddingInline={12}
      >
        <ProductLogo size={22} />
        <SkeletonBar height={26} radius={cssVar.borderRadius} width={26} />
      </Flexbox>
      <Flexbox horizontal flex={1} style={{ minHeight: 0, overflow: 'hidden' }} width={'100%'}>
        {!isMobile && (
          <Flexbox
            className={styles.sidebar}
            flex={'none'}
            gap={12}
            padding={12}
            width={SIDEBAR_WIDTH}
          >
            <SkeletonBar height={32} radius={cssVar.borderRadiusLG} />
            <Flexbox gap={8} paddingBlock={4}>
              <SkeletonBar height={14} width={'80%'} />
              <SkeletonBar height={14} width={'60%'} />
              <SkeletonBar height={14} width={'70%'} />
            </Flexbox>
          </Flexbox>
        )}
        <Flexbox flex={1} style={{ minWidth: 0, overflow: 'hidden' }}>
          <Flexbox
            horizontal
            align={'center'}
            className={styles.header}
            flex={'none'}
            gap={8}
            padding={12}
          >
            <SkeletonBar height={28} radius={'50%'} width={28} />
            <Flexbox gap={6}>
              <SkeletonBar height={14} width={120} />
              <SkeletonBar height={12} width={200} />
            </Flexbox>
          </Flexbox>
          <ConversationSegmentSkeleton />
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
};

export default AgentShareVisitorSkeleton;
