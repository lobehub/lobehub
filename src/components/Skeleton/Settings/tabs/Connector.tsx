'use client';

import { cssVar, Flexbox, Text } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import NavHeader from '@/features/NavHeader';

import SkeletonBar from '../../Bar';
import { SkillNavListSkeleton } from './Skill';
import type { SettingsTabSkeleton } from './types';

const SECTIONS = [
  { key: 'connectorMarket.section.installed', rows: 6 },
  { key: 'skillGroup.communityConnectors', rows: 4 },
] as const;

/** Mobile keeps the nav list, whose groups are the connector types. */
const NAV_SECTIONS = [
  { key: 'skillGroup.builtinTools', rows: 5 },
  { key: 'skillGroup.communityConnectors', rows: 4 },
] as const;

const Line = ({ bar, height, width }: { bar: number; height: number; width: number | string }) => (
  <Flexbox height={height} justify={'center'} style={{ minWidth: 0 }}>
    <SkeletonBar height={bar} width={width} />
  </Flexbox>
);

/** Search, Refresh and Skill Store icons, then the primary "Add" on the title row. */
const PageActions = () => (
  <Flexbox horizontal align={'center'} flex={'none'} gap={8}>
    <SkeletonBar height={32} width={240} />
    <SkeletonBar height={28} width={28} />
    <SkeletonBar height={28} width={28} />
    <SkeletonBar height={32} width={80} />
  </Flexbox>
);

/**
 * The connector page catalog (`LeftPanel` in page mode): the title, intro line
 * and page actions, then per group a heading with its count over a two-column
 * grid of `SkillListRow` page rows — a 40px icon tile, title + summary and one
 * trailing action. Headings and the intro are static copy.
 */
const PageList = () => {
  const { t } = useTranslation('setting');

  return (
    <Flexbox aria-busy data-testid={'settings-connector-skeleton'}>
      <Flexbox
        horizontal
        align={'flex-start'}
        gap={16}
        justify={'space-between'}
        paddingInline={12}
        style={{ flexShrink: 0, paddingBlock: '32px 8px' }}
      >
        <Flexbox gap={4}>
          <Text fontSize={cssVar.fontSizeHeading3} weight={600}>
            {t('skillView.connectors')}
          </Text>
          <Text type={'secondary'}>{t('skillView.connectorsDesc')}</Text>
        </Flexbox>
        <PageActions />
      </Flexbox>
      <Flexbox gap={40} style={{ paddingBlock: '24px' }}>
        {SECTIONS.map(({ key, rows }) => (
          <Flexbox gap={8} key={key}>
            <Flexbox horizontal align={'center'} gap={8} paddingInline={12}>
              <Text fontSize={cssVar.fontSizeHeading5} weight={600}>
                {t(key)}
              </Text>
              <SkeletonBar height={14} width={16} />
            </Flexbox>
            <div
              style={{
                columnGap: 32,
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                rowGap: 4,
              }}
            >
              {Array.from({ length: rows }, (_, index) => (
                <Flexbox
                  horizontal
                  align={'center'}
                  gap={12}
                  key={index}
                  paddingBlock={12}
                  paddingInline={12}
                  style={{ minHeight: 64, minWidth: 0 }}
                >
                  <SkeletonBar height={40} radius={cssVar.borderRadiusLG} width={40} />
                  <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
                    <Line bar={14} height={22} width={96 + (index % 3) * 32} />
                    <Line bar={12} height={20} width={`${64 + (index % 2) * 16}%`} />
                  </Flexbox>
                  <SkeletonBar height={20} width={20} />
                </Flexbox>
              ))}
            </div>
          </Flexbox>
        ))}
      </Flexbox>
    </Flexbox>
  );
};

/**
 * `ToolSettings` in connector mode draws its own header over a centred 1048px
 * column, so the skeleton draws that frame itself.
 */
const Page = () => (
  <Flexbox aria-busy flex={1} height={'100%'} style={{ minHeight: 0, overflow: 'hidden' }}>
    {/* The page draws its own title, so the navigation header stays empty. */}
    <NavHeader />
    <Flexbox horizontal flex={1} justify={'center'} style={{ overflow: 'hidden' }}>
      <Flexbox style={{ maxWidth: 1048, width: '100%' }}>
        <PageList />
      </Flexbox>
    </Flexbox>
  </Flexbox>
);

/** Mobile renders the nav-style list (title + add + store buttons) under the mobile header. */
const Body = () => (
  <SkillNavListSkeleton fullWidth sections={[...NAV_SECTIONS]} titleKey={'skillView.connectors'} />
);

const ConnectorSkeleton: SettingsTabSkeleton = { Body, Page };

export default ConnectorSkeleton;
