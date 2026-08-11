'use client';

import { Flexbox, FormGroup } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';

import SkeletonBar from '../Bar';

const styles = createStaticStyles(({ css }) => ({
  divider: css`
    width: 100%;
    height: 1px;
    background: ${cssVar.colorBorderSecondary};
  `,
  row: css`
    display: flex;
    gap: 24px;
    align-items: center;
    justify-content: space-between;

    min-height: 64px;
    padding-block: 16px;
  `,
}));

const Row = memo<{ index: number }>(({ index }) => (
  <div className={styles.row}>
    <Flexbox gap={8}>
      <SkeletonBar height={16} width={112 + (index % 2) * 40} />
      <SkeletonBar height={12} width={224 + (index % 3) * 36} />
    </Flexbox>
    <SkeletonBar height={32} width={index % 2 ? 152 : 88} />
  </div>
));

Row.displayName = 'SettingsSectionRowSkeleton';

const Group = memo<{ rows: number; titleWidth: number }>(({ rows, titleWidth }) => (
  <FormGroup
    collapsible={false}
    title={<SkeletonBar height={18} width={titleWidth} />}
    variant={'filled'}
  >
    <Flexbox>
      {Array.from({ length: rows }).map((_, index) => (
        <Flexbox key={index}>
          {index > 0 && <div className={styles.divider} />}
          <Row index={index} />
        </Flexbox>
      ))}
    </Flexbox>
  </FormGroup>
));

Group.displayName = 'SettingsSectionGroupSkeleton';

const SettingsSectionSkeleton = memo(() => (
  <Flexbox aria-busy data-testid={'settings-section-skeleton'} gap={36}>
    <Group rows={2} titleWidth={104} />
    <Group rows={3} titleWidth={136} />
  </Flexbox>
));

SettingsSectionSkeleton.displayName = 'SettingsSectionSkeleton';

export default SettingsSectionSkeleton;
