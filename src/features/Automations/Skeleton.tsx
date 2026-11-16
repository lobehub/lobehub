'use client';

import { Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';

import LiteTable, { type LiteTableColumn } from '@/components/LiteTable';
import { useSkeletonText } from '@/components/Skeleton/Settings/useSkeletonText';

import { COLUMN_WIDTH } from './columnWidth';

/** A header-only column: the skeleton rows never call `render`. */
const headColumn = (column: Partial<LiteTableColumn<never>> & { key: string }) =>
  ({ render: () => null, title: '', ...column }) as LiteTableColumn<never>;

/**
 * The automation list before it loads: the description above the table, whose
 * column heads are static copy. `LiteTable` draws the same skeleton rows the
 * list shows while fetching, so the hand-off is a cell swap. The route, the
 * chunk and the page's own feature-flag wait all render this one shape.
 */
const AutomationsSkeleton = () => {
  const text = useSkeletonText('setting');

  const columns = [
    headColumn({
      key: 'subscription',
      listSlot: 'title',
      title: text('automations.columns.subscription', 56, 14),
    }),
    headColumn({
      key: 'status',
      title: text('automations.columns.status', 40, 14),
      width: COLUMN_WIDTH.status,
    }),
    headColumn({
      key: 'target',
      title: text('automations.columns.target', 72, 14),
      width: COLUMN_WIDTH.target,
    }),
    headColumn({
      key: 'lastDelivery',
      title: text('automations.columns.lastDelivery', 72, 14),
      width: COLUMN_WIDTH.lastDelivery,
    }),
    headColumn({ key: 'actions', listSlot: 'extra', width: COLUMN_WIDTH.actions }),
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
      <div style={{ paddingBlockEnd: 16, paddingInline: 24 }}>
        <Text style={{ fontSize: 13 }} type={'secondary'}>
          {text('automations.desc', 320, 13)}
        </Text>
      </div>
      <LiteTable
        loading
        columns={columns}
        listBreakpoint={800}
        rowKey={() => ''}
        tableLayout={'fixed'}
      />
    </div>
  );
};

export default AutomationsSkeleton;
