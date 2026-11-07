'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';

import LiteTable, { type LiteTableColumn } from '@/components/LiteTable';

import SkeletonBar from '../../Bar';
import { useSkeletonText } from '../useSkeletonText';
import type { SettingsTabSkeleton } from './types';

/** A header-only column: the skeleton rows never call `render`. */
const headColumn = (column: Partial<LiteTableColumn<never>> & { key: string }) =>
  ({ render: () => null, title: '', ...column }) as LiteTableColumn<never>;

/**
 * The API key list: the titled header with its docs and create buttons above
 * the table, whose column heads are static copy. `LiteTable` draws the same
 * skeleton rows it shows while the list loads, so the hand-off is a cell swap.
 */
const Body = () => {
  const text = useSkeletonText('auth');

  const columns = [
    headColumn({ key: 'name', listSlot: 'title', title: text('apikey.list.columns.name', 40, 14) }),
    headColumn({ key: 'key', title: text('apikey.list.columns.key', 40, 14), width: 220 }),
    headColumn({ key: 'scopes', title: text('apikey.list.columns.scopes', 40, 14), width: 110 }),
    headColumn({
      key: 'expiresAt',
      title: text('apikey.list.columns.expiresAt', 56, 14),
      width: 130,
    }),
    headColumn({ key: 'lastUsedAt', title: text('apikey.list.columns.lastUsedAt', 56, 14) }),
    headColumn({ key: 'actions', listSlot: 'extra', width: 48 }),
  ];

  return (
    <div
      aria-busy
      style={{
        background: cssVar.colorBgContainer,
        borderRadius: cssVar.borderRadius,
        overflow: 'hidden',
        paddingBlock: 16,
      }}
    >
      <Flexbox
        horizontal
        align={'flex-start'}
        gap={16}
        justify={'space-between'}
        style={{ paddingBlockEnd: 16, paddingInline: 24 }}
      >
        <Flexbox gap={4}>
          <Text as={'h3'} style={{ fontSize: 16, fontWeight: 500, margin: 0 }}>
            {text('apikey.list.title', 72)}
          </Text>
          <Text style={{ fontSize: 13 }} type={'secondary'}>
            {text('apikey.list.desc', 280, 13)}
          </Text>
        </Flexbox>
        <Flexbox horizontal gap={8}>
          <SkeletonBar height={32} radius={8} width={96} />
          <SkeletonBar height={32} radius={8} width={88} />
        </Flexbox>
      </Flexbox>
      <LiteTable loading columns={columns} rowKey={() => ''} />
    </div>
  );
};

const APIKeySkeleton: SettingsTabSkeleton = { Body };

export default APIKeySkeleton;
