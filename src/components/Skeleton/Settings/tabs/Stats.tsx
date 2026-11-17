'use client';

import { cssVar, Divider, Flexbox } from '@lobehub/ui';
import { Form } from '@lobehub/ui/form';
import type { ReactNode } from 'react';

import SkeletonBar from '../../Bar';
import { useSkeletonText } from '../useSkeletonText';
import type { SettingsTabSkeleton } from './types';

/** A 96px figure tile: label, large figure and a "last month" caption. */
const Tile = ({ label }: { label?: ReactNode }) => (
  <Flexbox flex={1} gap={12} height={96} style={{ minWidth: 0 }}>
    <Flexbox height={22} justify={'center'}>
      {label ?? <SkeletonBar height={14} width={56} />}
    </Flexbox>
    <SkeletonBar height={28} width={64} />
    <SkeletonBar height={12} width={72} />
  </Flexbox>
);

const Rank = ({ title }: { title: ReactNode }) => (
  <Flexbox flex={1} gap={16} height={261} style={{ minWidth: 0 }}>
    <Flexbox height={22} justify={'center'} style={{ fontSize: 16, fontWeight: 600 }}>
      {title}
    </Flexbox>
    <Flexbox horizontal justify={'space-between'}>
      <SkeletonBar height={12} width={40} />
      <SkeletonBar height={12} width={40} />
    </Flexbox>
    {[0, 1, 2, 3, 4].map((index) => (
      <Flexbox horizontal align={'center'} gap={8} key={index}>
        <SkeletonBar height={20} radius={'50%'} width={20} />
        <SkeletonBar height={14} width={`${48 + (index % 3) * 12}%`} />
      </Flexbox>
    ))}
  </Flexbox>
);

/**
 * The stats tab: the overview group (figures, activity heatmap, rankings) and
 * the usage group (spend cards, trend chart, table), 36px apart like the two
 * settled `Form.Group`s. Group and section titles are static copy.
 */
const Body = () => {
  const text = useSkeletonText('auth');

  return (
    <Flexbox aria-busy gap={36}>
      <Form.Group
        collapsible={false}
        extra={<SkeletonBar height={32} width={32} />}
        variant={'filled'}
        title={
          <Flexbox gap={6} height={44} justify={'center'}>
            <SkeletonBar height={18} width={420} />
            <SkeletonBar height={12} width={240} />
          </Flexbox>
        }
      >
        <Flexbox horizontal gap={8}>
          <Tile label={text('stats.assistants', 56)} />
          <Tile label={text('stats.topics', 56)} />
          <Tile label={text('stats.messages', 56)} />
          <Tile label={text('stats.heatmapStats.totalTokens', 88)} />
        </Flexbox>
        <Divider dashed style={{ marginBlock: 24 }} />
        <Flexbox gap={16}>
          <Flexbox horizontal align={'center'} height={32} justify={'space-between'}>
            <Flexbox horizontal align={'center'} gap={12}>
              <span style={{ fontSize: 16, fontWeight: 600 }}>
                {text('stats.lastYearActivity', 112)}
              </span>
              <SkeletonBar height={32} width={156} />
            </Flexbox>
            <SkeletonBar height={24} width={112} />
          </Flexbox>
          <SkeletonBar height={88} radius={cssVar.borderRadiusLG} />
          <SkeletonBar height={173} radius={cssVar.borderRadiusLG} />
        </Flexbox>
        <Divider dashed style={{ marginBlock: 24 }} />
        <Flexbox horizontal gap={16} style={{ paddingBottom: 12 }}>
          <Rank title={text('stats.modelsRank.title', 80)} />
          <Rank title={text('stats.assistantsRank.title', 80)} />
          <Rank title={text('stats.topicsRank.title', 80)} />
        </Flexbox>
      </Form.Group>
      <Form.Group
        collapsible={false}
        title={<span style={{ lineHeight: '35px' }}>{text('tab.usage', 32)}</span>}
        variant={'filled'}
        extra={
          <Flexbox horizontal align={'center'} gap={8}>
            <SkeletonBar height={32} width={140} />
            <SkeletonBar height={38} width={188} />
          </Flexbox>
        }
      >
        <Flexbox horizontal gap={16}>
          <Tile />
          <Tile />
          <Tile />
        </Flexbox>
        <Divider style={{ marginBlock: 24 }} />
        <Flexbox gap={16}>
          <SkeletonBar height={38} width={140} />
          <SkeletonBar height={280} radius={cssVar.borderRadiusLG} />
        </Flexbox>
        <div style={{ height: 24 }} />
        <SkeletonBar height={194} radius={cssVar.borderRadiusLG} />
      </Form.Group>
    </Flexbox>
  );
};

const StatsSkeleton: SettingsTabSkeleton = { Body };

export default StatsSkeleton;
