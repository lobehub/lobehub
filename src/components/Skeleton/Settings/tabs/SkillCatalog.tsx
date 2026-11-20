'use client';

import { cssVar, Flexbox, Text } from '@lobehub/ui';
import { media } from '@lobehub/ui/stylex/media.stylex';
import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';

import NavHeader from '@/features/NavHeader';
import { useDensityTokens, useInterfaceDensity } from '@/styles/density';

import SkeletonBar from '../../Bar';

// No radius token reaches a pill (the Codex search field, Add and view tabs).
const PILL = 999;

const styles = stylex.create({
  grid: {
    columnGap: 16,
    display: 'grid',
    gridTemplateColumns: { default: 'repeat(2, minmax(0, 1fr))', [media.lg]: 'minmax(0, 1fr)' },
    rowGap: 4,
  },
});

interface SkillCatalogProps {
  viewMode: 'connector' | 'skill';
}

/**
 * The shared Codex-style catalog header and two-column rows used by skills and
 * connectors; mirrors `LeftPanel` + `SkillList` + `SkillListRow` page geometry.
 */
export const SkillCatalogListSkeleton = ({ viewMode }: SkillCatalogProps) => {
  const { t } = useTranslation('setting');
  // Compact `SkillListRow` page rows: 6px padding, 32px tile, 20 + 2 + 18px text → 52px.
  const compact = useInterfaceDensity() === 'compact';
  const { controlHeight } = useDensityTokens();
  const skills = viewMode === 'skill';
  const sections = skills
    ? (['skillGroup.communitySkills', 'skillGroup.customSkills'] as const)
    : (['connectorMarket.section.installed', 'skillGroup.communityConnectors'] as const);

  return (
    <Flexbox aria-busy data-testid={`settings-${viewMode}-skeleton`}>
      <Flexbox gap={8} paddingInline={12} style={{ flexShrink: 0, paddingBlock: '32px 8px' }}>
        <Flexbox
          horizontal
          align={'center'}
          gap={16}
          justify={'space-between'}
          style={{ flexWrap: 'wrap' }}
        >
          <Text fontSize={cssVar.fontSizeHeading3} weight={600}>
            {t(skills ? 'skillView.skills' : 'skillView.connectors')}
          </Text>
          <Flexbox horizontal align={'center'} gap={12}>
            <SkeletonBar height={controlHeight} radius={PILL} width={240} />
            <SkeletonBar height={controlHeight} width={controlHeight} />
            <SkeletonBar height={controlHeight} radius={PILL} width={88} />
          </Flexbox>
        </Flexbox>
        <Text type={'secondary'}>
          {t(skills ? 'skillView.skillsDesc' : 'skillView.connectorsDesc')}
        </Text>
      </Flexbox>
      {skills && (
        // The Discover / Installed view tabs
        <Flexbox horizontal gap={8} paddingInline={12} style={{ paddingBlockStart: 12 }}>
          <SkeletonBar height={controlHeight} radius={PILL} width={72} />
          <SkeletonBar height={controlHeight} radius={PILL} width={72} />
        </Flexbox>
      )}
      <Flexbox gap={32} paddingBlock={24}>
        {sections.map((key, section) => (
          <Flexbox gap={12} key={key}>
            <Flexbox horizontal align={'center'} gap={8} paddingInline={12}>
              <Text fontSize={cssVar.fontSizeHeading5} weight={600}>
                {t(key)}
              </Text>
            </Flexbox>
            <div {...stylex.props(styles.grid)}>
              {Array.from({ length: section === 0 ? 6 : 4 }, (_, index) => (
                <Flexbox
                  horizontal
                  align={'center'}
                  gap={12}
                  key={index}
                  paddingBlock={compact ? 6 : 8}
                  paddingInline={12}
                  style={{ minHeight: compact ? 48 : 64, minWidth: 0 }}
                >
                  <SkeletonBar
                    height={compact ? 32 : 36}
                    radius={cssVar.borderRadius}
                    width={compact ? 32 : 36}
                  />
                  <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
                    <Flexbox height={compact ? 20 : 22} justify={'center'}>
                      <SkeletonBar height={14} width={96 + (index % 3) * 32} />
                    </Flexbox>
                    <Flexbox height={compact ? 18 : 22} justify={'center'}>
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
      paddingInline={24}
      style={{ overflow: 'hidden' }}
    >
      <Flexbox style={{ maxWidth: 920, width: '100%' }}>
        <SkillCatalogListSkeleton {...props} />
      </Flexbox>
    </Flexbox>
  </Flexbox>
);
