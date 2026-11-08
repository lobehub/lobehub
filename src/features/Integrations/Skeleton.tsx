'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import SkeletonBar from '@/components/Skeleton/Bar';

const styles = stylex.create({
  // `IntegrationCard`: filled, 14px/16px padding, 40px icon tile.
  card: {
    paddingBlock: '14px',
    paddingInline: '16px',
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorFillQuaternary,
  },
  column: {
    width: '100%',
    maxWidth: '760px',
    marginInline: 'auto',
  },
  // `Connections` card: filled, rows 10px apart from its 2px inset.
  connections: {
    paddingBlock: '2px',
    paddingInline: '16px',
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorFillQuaternary,
  },
  list: {
    display: 'grid',
    gridTemplateColumns: '1fr',
    gap: '10px',
  },
  sectionLabel: {
    fontSize: '12px',
    fontWeight: 500,
    color: cssVar.colorTextTertiary,
  },
  upcoming: {
    display: 'grid',
    gridTemplateColumns: {
      'default': 'repeat(2, 1fr)',
      '@media (width <= 720px)': '1fr',
    },
    gap: '8px',
  },
  upcomingCard: {
    paddingBlock: '10px',
    paddingInline: '14px',
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorFillQuaternary,
  },
});

const Line = ({ bar, height, width }: { bar: number; height: number; width: number | string }) => (
  <Flexbox height={height} justify={'center'} style={{ minWidth: 0 }}>
    <SkeletonBar height={bar} width={width} />
  </Flexbox>
);

/**
 * The integrations directory until every integration's connection state has
 * loaded: the "All" list and the "Coming soon" grid. Section labels are static
 * copy; the Enabled strip only appears once a connection is known, so the
 * directory swaps in once instead of statuses and the strip popping in apart.
 */
export const IntegrationsOverviewSkeleton = ({
  available = 2,
  upcoming = 4,
}: {
  available?: number;
  upcoming?: number;
}) => {
  const { t } = useTranslation('integration');

  return (
    <Flexbox aria-busy data-testid={'integrations-overview-skeleton'} gap={24}>
      <Flexbox gap={10}>
        <span {...stylex.props(styles.sectionLabel)}>{t('overview.all')}</span>
        <div {...stylex.props(styles.list)}>
          {Array.from({ length: available }, (_, index) => (
            <Flexbox
              horizontal
              align={'center'}
              gap={14}
              key={index}
              {...stylex.props(styles.card)}
            >
              <SkeletonBar height={40} width={40} />
              <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
                <Line bar={15} height={24} width={72 + (index % 2) * 16} />
                <Line bar={12} height={22} width={'64%'} />
              </Flexbox>
              <Line bar={12} height={22} width={64} />
            </Flexbox>
          ))}
        </div>
      </Flexbox>
      <Flexbox gap={10}>
        <span {...stylex.props(styles.sectionLabel)}>{t('overview.comingSoon')}</span>
        <div {...stylex.props(styles.upcoming)}>
          {Array.from({ length: upcoming }, (_, index) => (
            <Flexbox
              horizontal
              align={'center'}
              gap={14}
              key={index}
              {...stylex.props(styles.upcomingCard)}
            >
              <SkeletonBar height={32} width={32} />
              {/* Name over a one-line tagline, as `UpcomingCard` renders. */}
              <Flexbox flex={1} style={{ minWidth: 0 }}>
                <Line bar={14} height={24} width={64 + (index % 2) * 16} />
                <Line bar={12} height={22} width={'72%'} />
              </Flexbox>
              <Line bar={12} height={22} width={56} />
            </Flexbox>
          ))}
        </div>
      </Flexbox>
    </Flexbox>
  );
};

/**
 * An integration's Connections section while it loads: the title + small
 * connect button row above one filled connection row (36px avatar, name and
 * detail line, status).
 */
export const IntegrationConnectionsSkeleton = ({ title }: { title?: string }) => (
  <Flexbox aria-busy gap={10}>
    <Flexbox horizontal align={'center'} gap={16} justify={'space-between'}>
      {title ? (
        <Text strong style={{ fontSize: 16 }}>
          {title}
        </Text>
      ) : (
        <Line bar={16} height={24} width={96} />
      )}
      <SkeletonBar height={24} width={88} />
    </Flexbox>
    <div {...stylex.props(styles.connections)}>
      <Flexbox horizontal align={'center'} gap={12} paddingBlock={10}>
        <SkeletonBar height={36} radius={'50%'} width={36} />
        <Flexbox flex={1} gap={1} style={{ minWidth: 0 }}>
          <Line bar={14} height={22} width={120} />
          <Line bar={12} height={22} width={'48%'} />
        </Flexbox>
        <Line bar={14} height={30} width={72} />
      </Flexbox>
    </div>
  </Flexbox>
);

/**
 * `/settings/integrations/:id` before its chunk loads: the back link (static
 * copy), the 56px hero with name + tagline, and the Connections section.
 */
export const IntegrationDetailSkeleton = () => {
  const { t } = useTranslation('integration');

  return (
    <Flexbox aria-busy data-testid={'integration-detail-skeleton'} gap={24}>
      <Flexbox horizontal align={'center'} gap={6}>
        <SkeletonBar height={14} width={14} />
        <Text type={'secondary'}>{t('overview.title')}</Text>
      </Flexbox>
      <Flexbox horizontal align={'center'} gap={16}>
        <SkeletonBar height={56} radius={cssVar.borderRadiusLG} width={56} />
        <Flexbox flex={1} gap={2}>
          <Line bar={20} height={30} width={96} />
          <Line bar={14} height={22} width={'56%'} />
        </Flexbox>
        <Line bar={13} height={22} width={88} />
      </Flexbox>
      <IntegrationConnectionsSkeleton />
    </Flexbox>
  );
};

/** `IntegrationsLayout`'s reading-width column, for skeletons outside the layout. */
export const IntegrationsColumn = ({ children }: { children: ReactNode }) => (
  <div {...stylex.props(styles.column)}>{children}</div>
);
