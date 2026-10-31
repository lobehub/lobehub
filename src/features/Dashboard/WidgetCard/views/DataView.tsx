'use client';

import type { WidgetDataOutput } from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';

import { formatLayoutValue } from './LayoutView/resolve';

/**
 * A `data` output whose version has no layout yet: its top-level scalar
 * fields as label / value rows, so the card still shows what the script
 * reported instead of nothing.
 */
const DataView = memo<{ output: WidgetDataOutput }>(({ output }) => {
  const rows = Object.entries(output.data).filter(
    ([, value]) => value === null || typeof value !== 'object',
  );

  return (
    <Flexbox gap={4}>
      {rows.map(([key, value]) => (
        <Flexbox horizontal gap={12} justify={'space-between'} key={key}>
          <Text ellipsis fontSize={12} type={'secondary'}>
            {key}
          </Text>
          <Text ellipsis fontSize={13} weight={500}>
            {formatLayoutValue(value)}
          </Text>
        </Flexbox>
      ))}
    </Flexbox>
  );
});

DataView.displayName = 'DashboardDataView';

export default DataView;
