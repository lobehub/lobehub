'use client';

import { cssVar, Flexbox, Text } from '@lobehub/ui';
import { media } from '@lobehub/ui/stylex/media.stylex';
import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';

import NavHeader from '@/features/NavHeader';
import { useDensityTokens, useInterfaceDensity } from '@/styles/density';

import SkeletonBar from '../../Bar';

const styles = stylex.create({
  grid: {
    columnGap: 32,
    display: 'grid',
    gridTemplateColumns: { default: 'repeat(2, minmax(0, 1fr))', [media.lg]: 'minmax(0, 1fr)' },
    rowGap: 4,
  },
});

interface SkillCatalogProps {
  viewMode: 'connector' | 'skill';
}

/** The shared catalog header and two-column rows used by skills and connectors. */
export const SkillCatalogListSkeleton = ({ viewMode }: SkillCatalogProps) => {
  const { t } = useTranslation('setting');
  // Compact `SkillListRow` page rows: 6px padding, 32px tile, 20 + 2 + 18px text → 52px.
  const compact = useInterfaceDensity() === 'compact';
  const { controlHeight } = useDensityTokens();
  const skills = viewMode === 'skill';
  const sections = skills
    ? (['skillGroup.builtinSkills', 'skillGroup.communitySkills'] as const)
    : (['connectorMarket.section.installed', 'skillGroup.communityConnectors'] as const);

  return (
    <Flexbox aria-busy data-testid={`settings-${viewMode}-skeleton`}>
      <Flexbox
        horizontal
        align={'flex-start'}
        gap={16}
        justify={'space-between'}
        paddingInline={12}
        style={{ flexShrink: 0, flexWrap: 'wrap', paddingBlock: '32px 8px' }}
      >
        <Flexbox gap={4}>
          <Text fontSize={cssVar.fontSizeHeading3} weight={600}>
            {t(skills ? 'skillView.skills' : 'skillView.connectors')}
          </Text>
          <Text type={'secondary'}>
            {t(skills ? 'skillView.skillsDesc' : 'skillView.connectorsDesc')}
          </Text>
        </Flexbox>
        <Flexbox horizontal align={'center'} gap={8}>
          <SkeletonBar height={controlHeight} width={240} />
          <SkeletonBar height={controlHeight} width={80} />
        </Flexbox>
      </Flexbox>
      <Flexbox gap={40} paddingBlock={24}>
        {sections.map((key, section) => (
          <Flexbox gap={8} key={key}>
            <Flexbox horizontal align={'center'} gap={8} paddingInline={12}>
              <Text fontSize={cssVar.fontSizeHeading5} weight={600}>
                {t(key)}
              </Text>
              <SkeletonBar height={14} width={16} />
            </Flexbox>
            <div {...stylex.props(styles.grid)}>
              {Array.from({ length: section === 0 ? 6 : 4 }, (_, index) => (
                <Flexbox
                  horizontal
                  align={'center'}
                  gap={12}
                  key={index}
                  paddingBlock={compact ? 6 : 12}
                  paddingInline={12}
                  style={{ minHeight: compact ? 48 : 64, minWidth: 0 }}
                >
                  <SkeletonBar
                    height={compact ? 32 : 40}
                    radius={cssVar.borderRadiusLG}
                    width={compact ? 32 : 40}
                  />
                  <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
                    <Flexbox height={compact ? 20 : 22} justify={'center'}>
                      <SkeletonBar height={14} width={96 + (index % 3) * 32} />
                    </Flexbox>
                    <Flexbox height={compact ? 18 : 20} justify={'center'}>
                      <SkeletonBar height={12} width={`${64 + (index % 2) * 16}%`} />
                    </Flexbox>
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

export const SkillCatalogPageSkeleton = (props: SkillCatalogProps) => (
  <Flexbox aria-busy flex={1} height={'100%'} style={{ minHeight: 0, overflow: 'hidden' }}>
    <NavHeader />
    <Flexbox
      horizontal
      flex={1}
      justify={'center'}
      paddingInline={12}
      style={{ overflow: 'hidden' }}
    >
      <Flexbox style={{ maxWidth: 1048, width: '100%' }}>
        <SkillCatalogListSkeleton {...props} />
      </Flexbox>
    </Flexbox>
  </Flexbox>
);
