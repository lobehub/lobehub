'use client';

import { TRASH_RETENTION_DAYS } from '@lobechat/const';
import { Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { useTranslation } from 'react-i18next';

import LiteTable, { type LiteTableColumn } from '@/components/LiteTable';

import SkeletonBar from '../../Bar';
import { useSkeletonText } from '../useSkeletonText';
import type { SettingsTabSkeleton } from './types';

/** A header-only column: the skeleton rows never call `render`. */
const headColumn = (column: Partial<LiteTableColumn<never>> & { key: string }) =>
  ({ render: () => null, title: '', ...column }) as LiteTableColumn<never>;

/** Leading type icon (28px) + gap (10px) the name column header is inset by. */
const NAME_INSET = 38;

/**
 * The retention note above the bin: type filter and "Empty" button over the
 * fixed-layout table, whose column heads are static copy. `LiteTable` draws the
 * same skeleton rows `TrashList` shows while its first page loads.
 */
const Body = () => {
  const { t, ready } = useTranslation('setting');
  const text = useSkeletonText('setting');

  const columns = [
    headColumn({
      key: 'name',
      listSlot: 'title',
      title: (
        <span style={{ paddingInlineStart: NAME_INSET }}>{text('trash.columns.name', 32, 14)}</span>
      ),
      width: 'clamp(320px, 36cqw, 420px)',
    }),
    headColumn({ key: 'type', title: text('trash.columns.type', 32, 14) }),
    headColumn({ key: 'deletedAt', title: text('trash.columns.deletedAt', 56, 14) }),
    headColumn({ key: 'expiresAt', title: text('trash.columns.expiresIn', 56, 14) }),
    headColumn({ key: 'actions', listSlot: 'actions', width: 200 }),
  ];

  return (
    <Flexbox aria-busy gap={12}>
      <Text type={'secondary'}>
        {ready ? (
          t('trash.desc', { days: TRASH_RETENTION_DAYS })
        ) : (
          <SkeletonBar height={14} width={320} />
        )}
      </Text>
      <div
        style={{
          background: cssVar.colorBgContainer,
          borderRadius: cssVar.borderRadius,
          overflow: 'hidden',
          paddingBlock: 16,
        }}
      >
        <Flexbox
          horizontal
          align={'center'}
          gap={12}
          justify={'space-between'}
          style={{ paddingBlockEnd: 16, paddingInline: 24 }}
        >
          <SkeletonBar height={32} radius={8} width={56} />
          <SkeletonBar height={32} radius={8} width={112} />
        </Flexbox>
        <LiteTable
          loading
          columns={columns}
          listBreakpoint={800}
          rowKey={() => ''}
          tableLayout={'fixed'}
        />
      </div>
    </Flexbox>
  );
};

const TrashSkeleton: SettingsTabSkeleton = { Body };

export default TrashSkeleton;
