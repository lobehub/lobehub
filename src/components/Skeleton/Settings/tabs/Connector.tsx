'use client';

import { cssVar, Flexbox, Text } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import SkeletonBar from '../../Bar';
import { SettingsSkeletonHeader } from '../Frame';
import { SkillNavListSkeleton } from './Skill';
import type { SettingsTabSkeleton } from './types';

const SECTIONS = [
  { key: 'skillGroup.builtinTools', rows: 5 },
  { key: 'skillGroup.communityConnectors', rows: 4 },
] as const;

const Line = ({ bar, height, width }: { bar: number; height: number; width: number | string }) => (
  <Flexbox height={height} justify={'center'} style={{ minWidth: 0 }}>
    <SkeletonBar height={bar} width={width} />
  </Flexbox>
);

/** The Store icon button and "Add Custom Connector" button on the intro row. */
const PageActions = () => (
  <Flexbox horizontal flex={'none'} gap={8}>
    <SkeletonBar height={32} width={32} />
    <SkeletonBar height={32} width={176} />
  </Flexbox>
);

/**
 * The connector page list (`LeftPanel` in page mode): the intro line with the
 * page actions, then
 * per group a 13px heading with its count and `SkillListRow` page rows — a 36px
 * icon tile, title + summary, status and chevron in a 60px row. Headings and
 * the intro are static copy.
 */
const PageList = () => {
  const { t } = useTranslation('setting');

  return (
    <Flexbox aria-busy data-testid={'settings-connector-skeleton'}>
      <Flexbox
        horizontal
        align={'center'}
        gap={16}
        justify={'space-between'}
        paddingInline={12}
        style={{ flexShrink: 0, paddingBlock: '24px 4px' }}
      >
        <Text type={'secondary'}>{t('skillView.connectorsDesc')}</Text>
        <PageActions />
      </Flexbox>
      <Flexbox gap={2} style={{ paddingBlockEnd: 24 }}>
        {SECTIONS.map(({ key, rows }) => (
          <Flexbox gap={2} key={key}>
            <Flexbox
              horizontal
              align={'center'}
              gap={8}
              paddingInline={12}
              style={{ paddingBlock: '24px 8px' }}
            >
              <Text fontSize={13} weight={600}>
                {t(key)}
              </Text>
              <SkeletonBar height={12} width={16} />
            </Flexbox>
            {Array.from({ length: rows }, (_, index) => (
              <Flexbox
                horizontal
                align={'center'}
                gap={12}
                key={index}
                paddingBlock={10}
                paddingInline={12}
                style={{ minHeight: 60 }}
              >
                <SkeletonBar height={36} radius={cssVar.borderRadius} width={36} />
                <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
                  <Line bar={14} height={22} width={96 + (index % 3) * 32} />
                  <Line bar={12} height={18} width={`${48 + (index % 2) * 16}%`} />
                </Flexbox>
                <Line bar={12} height={20} width={56} />
                <SkeletonBar height={16} width={16} />
              </Flexbox>
            ))}
          </Flexbox>
        ))}
      </Flexbox>
    </Flexbox>
  );
};

/**
 * `ToolSettings` in connector mode draws its own header over a centred 960px
 * column, so the skeleton draws that frame itself.
 */
const Page = () => (
  <Flexbox aria-busy flex={1} height={'100%'} style={{ minHeight: 0, overflow: 'hidden' }}>
    <SettingsSkeletonHeader tab={'connector'} />
    <Flexbox horizontal flex={1} justify={'center'} style={{ overflow: 'hidden' }}>
      <Flexbox style={{ maxWidth: 960, width: '100%' }}>
        <PageList />
      </Flexbox>
    </Flexbox>
  </Flexbox>
);

/** Mobile renders the nav-style list (title + add + store buttons) under the mobile header. */
const Body = () => (
  <SkillNavListSkeleton fullWidth sections={[...SECTIONS]} titleKey={'skillView.connectors'} />
);

const ConnectorSkeleton: SettingsTabSkeleton = { Body, Page };

export default ConnectorSkeleton;
