'use client';

import { Flexbox, Tabs, Text } from '@lobehub/ui';

import { LABEL_COLUMN_WIDTHS } from '@/features/WorkspaceSetting/Labels/constants';

import SkeletonBar from '../../Bar';
import { useSkeletonText } from '../useSkeletonText';
import type { SettingsTabSkeleton } from './types';

const ROWS = 4;

/**
 * The label table while the registry loads: the static column header, then
 * 42px rows (color dot + name, description, usage, created date, menu) on the
 * same column widths as the loaded rows.
 */
export const LabelsListSkeleton = () => {
  const text = useSkeletonText('setting');
  const head = (key: string, width: number) =>
    text(`workspaceSetting.labels.columns.${key}`, width, 12);

  return (
    <Flexbox aria-busy gap={2}>
      <Flexbox horizontal align={'center'} gap={12} paddingInline={12} style={{ paddingBlock: 4 }}>
        <Text
          fontSize={12}
          style={{ flex: 'none', width: LABEL_COLUMN_WIDTHS.name }}
          type={'secondary'}
        >
          {head('name', 32)}
        </Text>
        <Text ellipsis fontSize={12} style={{ flex: 1, minWidth: 0 }} type={'secondary'}>
          {head('description', 48)}
        </Text>
        <Text
          fontSize={12}
          style={{ flex: 'none', textAlign: 'end', width: LABEL_COLUMN_WIDTHS.usage }}
          type={'secondary'}
        >
          {head('usage', 40)}
        </Text>
        <Text
          fontSize={12}
          style={{ flex: 'none', textAlign: 'end', width: LABEL_COLUMN_WIDTHS.created }}
          type={'secondary'}
        >
          {head('created', 48)}
        </Text>
        <span style={{ flex: 'none', width: LABEL_COLUMN_WIDTHS.action }} />
      </Flexbox>
      {Array.from({ length: ROWS }, (_, index) => (
        <Flexbox horizontal align={'center'} gap={12} height={42} key={index} paddingInline={12}>
          <Flexbox
            horizontal
            align={'center'}
            flex={'none'}
            gap={12}
            style={{ width: LABEL_COLUMN_WIDTHS.name }}
          >
            <SkeletonBar height={10} radius={'50%'} width={10} />
            <SkeletonBar height={14} width={72 + (index % 3) * 24} />
          </Flexbox>
          <Flexbox flex={1} style={{ minWidth: 0 }}>
            <SkeletonBar height={12} width={`${40 + (index % 2) * 20}%`} />
          </Flexbox>
          <Flexbox align={'flex-end'} flex={'none'} style={{ width: LABEL_COLUMN_WIDTHS.usage }}>
            <SkeletonBar height={12} width={48} />
          </Flexbox>
          <Flexbox align={'flex-end'} flex={'none'} style={{ width: LABEL_COLUMN_WIDTHS.created }}>
            <SkeletonBar height={12} width={72} />
          </Flexbox>
          <span style={{ flex: 'none', width: LABEL_COLUMN_WIDTHS.action }} />
        </Flexbox>
      ))}
    </Flexbox>
  );
};

/**
 * The agent/task label tabs, then the toolbar (search, scope filter, create
 * button) above the label table.
 */
const Body = () => {
  const text = useSkeletonText('setting');

  return (
    <Flexbox gap={16}>
      <Tabs
        activeKey={'agent'}
        items={[
          { key: 'agent', label: text('taskLabels.tabs.agent', 56, 14) },
          { key: 'task', label: text('taskLabels.tabs.task', 56, 14) },
        ]}
      />
      <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
        <Flexbox horizontal align={'center'} gap={8}>
          <SkeletonBar height={32} radius={8} width={200} />
          <SkeletonBar height={32} radius={8} width={76} />
        </Flexbox>
        <SkeletonBar height={32} radius={8} width={104} />
      </Flexbox>
      <LabelsListSkeleton />
    </Flexbox>
  );
};

const LabelsSkeleton: SettingsTabSkeleton = { Body };

export default LabelsSkeleton;
