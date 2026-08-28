'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';

import SkeletonBar from './Bar';

const styles = createStaticStyles(({ css }) => ({
  composer: css`
    overflow: hidden;

    height: 106px;
    border: 1px solid ${cssVar.colorFill};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgElevated};
  `,
  grid: css`
    display: grid;
    grid-template-columns: minmax(0, 1fr) 394px;
    gap: 24px 28px;
    width: 100%;

    @media (width <= 1100px) {
      grid-template-columns: 1fr;
    }
  `,
  rail: css`
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding-inline-end: 14px;

    @media (width <= 1100px) {
      display: none;
    }
  `,
  railCard: css`
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillQuaternary};
  `,
  row: css`
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillQuaternary};
  `,
}));

const ComposerSkeleton = () => (
  <Flexbox className={styles.composer}>
    <Flexbox flex={1} paddingBlock={'14px 8px'} paddingInline={14}>
      <SkeletonBar height={14} width={'32%'} />
    </Flexbox>
    <Flexbox horizontal align={'center'} height={44} justify={'space-between'} paddingInline={10}>
      <Flexbox horizontal gap={6}>
        <SkeletonBar height={28} radius={'50%'} width={28} />
        <SkeletonBar height={28} radius={'50%'} width={28} />
      </Flexbox>
      <SkeletonBar height={32} radius={16} width={64} />
    </Flexbox>
  </Flexbox>
);

const HomeSkeleton = () => (
  <Flexbox
    aria-busy
    flex={1}
    height={'100%'}
    style={{ overflow: 'hidden', paddingBlock: '32px 24px', paddingInline: 24 }}
    width={'100%'}
  >
    <Flexbox style={{ marginInline: 'auto', maxWidth: 1240 }} width={'100%'}>
      <div className={styles.grid}>
        <Flexbox gap={16} style={{ minWidth: 0 }}>
          <Flexbox gap={10} paddingBlock={'24px 8px'}>
            <SkeletonBar height={26} width={'38%'} />
          </Flexbox>
          <ComposerSkeleton />
          <Flexbox gap={8} paddingBlock={12}>
            <SkeletonBar height={14} width={96} />
            {Array.from({ length: 3 }).map((_, index) => (
              <Flexbox
                horizontal
                align={'center'}
                className={styles.row}
                gap={10}
                key={index}
                padding={'12px 14px'}
              >
                <SkeletonBar height={24} radius={'50%'} width={24} />
                <Flexbox flex={1} gap={6}>
                  <SkeletonBar height={13} width={`${32 + (index % 3) * 14}%`} />
                  <SkeletonBar height={11} width={`${52 + (index % 2) * 20}%`} />
                </Flexbox>
              </Flexbox>
            ))}
          </Flexbox>
        </Flexbox>
        <div className={styles.rail}>
          <Flexbox className={styles.railCard} gap={10} padding={16}>
            <SkeletonBar height={14} width={120} />
            <SkeletonBar height={12} width={'82%'} />
            <SkeletonBar height={12} width={'64%'} />
          </Flexbox>
          <Flexbox className={styles.railCard} gap={10} padding={16}>
            <SkeletonBar height={14} width={96} />
            <SkeletonBar height={12} width={'74%'} />
            <SkeletonBar height={12} width={'58%'} />
          </Flexbox>
        </div>
      </div>
    </Flexbox>
  </Flexbox>
);

export default HomeSkeleton;
