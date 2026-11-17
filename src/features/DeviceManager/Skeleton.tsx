'use client';

import { createStaticStyles, cssVar, Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import SkeletonBar from '@/components/Skeleton/Bar';

import DeviceGrid from './DeviceGrid';
import { UsageMeterSkeleton } from './DeviceHealth/UsageMeter';

const styles = createStaticStyles(({ css }) => ({
  // Same frame and sections as `DeviceCard`.
  body: css`
    padding-block: 20px 16px;
    padding-inline: 20px;
  `,
  // Same frame as `DetailCard` in `DeviceOverview`.
  detailCard: css`
    overflow: hidden;
    display: flex;
    flex-direction: column;

    min-width: 0;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
  `,
  detailCardHeader: css`
    padding-block: 10px;
    padding-inline: 16px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    background: ${cssVar.colorFillQuaternary};
  `,
  detailGrid: css`
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
    gap: 16px;
  `,
  detailRow: css`
    min-height: 48px;
    padding-block: 10px;
    padding-inline: 16px;

    & + & {
      border-block-start: 1px solid ${cssVar.colorBorderSecondary};
    }
  `,
  tabs: css`
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  card: css`
    overflow: hidden;
    display: flex;
    flex-direction: column;

    min-width: 0;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};
  `,
  footer: css`
    margin-block-start: auto;
    padding-block: 12px;
    padding-inline: 20px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorFillQuaternary};
  `,
  infoGrid: css`
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 16px;
  `,
  meterGroup: css`
    display: grid;
    grid-template-columns: 96px minmax(0, 1fr) 36px;
    gap: 8px 12px;
    align-items: center;
  `,
  // Always two rows of cards, whatever the column count the grid steps to.
  twoRows: css`
    & > :nth-child(n + 3) {
      display: none;
    }

    @container device-grid (min-width: 560px) {
      & > :nth-child(n + 3) {
        display: flex;
      }

      & > :nth-child(n + 5) {
        display: none;
      }
    }

    @container device-grid (min-width: 880px) {
      & > :nth-child(n + 5) {
        display: flex;
      }

      & > :nth-child(n + 7) {
        display: none;
      }
    }

    @container device-grid (min-width: 1200px) {
      & > :nth-child(n + 7) {
        display: flex;
      }
    }
  `,
}));

/** A text placeholder centered in the line box of the text it stands in for. */
const Line = ({
  barHeight,
  height,
  width,
}: {
  barHeight: number;
  height: number;
  width: number | string;
}) => (
  <Flexbox justify={'center'} style={{ height, minWidth: 0 }}>
    <SkeletonBar height={barHeight} width={width} />
  </Flexbox>
);

const CardSkeleton = () => (
  <div className={styles.card}>
    <Flexbox className={styles.body} gap={20}>
      <Flexbox horizontal align={'flex-start'} gap={16}>
        <SkeletonBar height={48} radius={12} width={48} />
        <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
          <Line barHeight={16} height={24} width={'60%'} />
          <Line barHeight={12} height={20} width={'36%'} />
        </Flexbox>
      </Flexbox>
      <div className={styles.infoGrid}>
        {Array.from({ length: 2 }, (_, index) => (
          <Flexbox gap={4} key={index} style={{ minWidth: 0 }}>
            <Line barHeight={12} height={20} width={'56%'} />
            <Line barHeight={12} height={20} width={'72%'} />
          </Flexbox>
        ))}
      </div>
      <div className={styles.meterGroup}>
        <UsageMeterSkeleton />
        <UsageMeterSkeleton />
      </div>
    </Flexbox>
    <Flexbox horizontal align={'center'} className={styles.footer} gap={8}>
      <SkeletonBar height={8} radius={'50%'} width={8} />
      <Line barHeight={12} height={20} width={'48%'} />
    </Flexbox>
  </div>
);

/**
 * Loading placeholder in the card grid's shape — two rows of `DeviceCard`
 * outlines — so loading → loaded is a content swap, not a relayout (ux §4.1).
 */
export const DeviceGridSkeleton = memo(() => (
  <DeviceGrid className={styles.twoRows}>
    {Array.from({ length: 8 }, (_, index) => (
      <CardSkeleton key={index} />
    ))}
  </DeviceGrid>
));

DeviceGridSkeleton.displayName = 'DeviceGridSkeleton';

/**
 * The devices list as `DeviceManager` lays it out: the toolbar (leading slot —
 * the workspace visibility tabs — then refresh + primary connect button) above
 * the same card grid the list shows while it loads, so the chunk wait hands
 * over to the data wait without a second skeleton. The personal page has no
 * visibility tabs, so it passes `leading={false}`.
 */
export const DevicesListSkeleton = ({ leading = true }: { leading?: boolean }) => (
  <Flexbox aria-busy data-testid={'devices-list-skeleton'} gap={16}>
    <Flexbox horizontal align={'center'} gap={16} justify={'space-between'}>
      <div>{leading && <SkeletonBar height={36} width={200} />}</div>
      <Flexbox horizontal align={'center'} gap={8}>
        <SkeletonBar height={36} width={36} />
        <SkeletonBar height={36} width={140} />
      </Flexbox>
    </Flexbox>
    <DeviceGridSkeleton />
  </Flexbox>
);

interface DetailCardShape {
  /** `InfoRow` labels; activity cards list topics / agents instead. */
  labels?: readonly string[];
  rows: number;
  titleKey: string;
}

const DETAIL_CARDS: DetailCardShape[] = [
  {
    labels: [
      'devices.detail.status',
      'devices.detail.os',
      'devices.detail.connections',
      'devices.detail.lastConnected',
    ],
    rows: 4,
    titleKey: 'devices.detail.runtime',
  },
  {
    labels: [
      'devices.card.hostname',
      'devices.detail.architecture',
      'devices.detail.cpu',
      'devices.detail.memory',
      'devices.card.workingDir',
    ],
    rows: 5,
    titleKey: 'devices.detail.specs',
  },
  { rows: 2, titleKey: 'devices.activity.runningTopics.title' },
  { rows: 2, titleKey: 'devices.activity.boundAgents.title' },
];

/**
 * `DeviceDetail` while the device list resolves: the back button, the 56px icon
 * tile + name + id header, the tab strip and the overview's two rows of info
 * cards. Static copy (back, tab and card labels) renders as text.
 */
export const DeviceDetailSkeleton = memo(() => {
  const { t } = useTranslation('setting');

  return (
    <Flexbox aria-busy data-testid={'device-detail-skeleton'} gap={24}>
      <Flexbox horizontal>
        <Flexbox horizontal align={'center'} gap={6} height={24} paddingInline={7}>
          <SkeletonBar height={14} width={14} />
          <Text type={'secondary'}>{t('devices.detail.back')}</Text>
        </Flexbox>
      </Flexbox>
      <Flexbox horizontal align={'center'} gap={16}>
        <SkeletonBar height={56} radius={14} width={56} />
        <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
          <Line barHeight={22} height={33} width={220} />
          <Line barHeight={13} height={24} width={280} />
        </Flexbox>
      </Flexbox>
      <Flexbox horizontal className={styles.tabs} gap={24} height={46}>
        {(['overview', 'files', 'agents'] as const).map((key) => (
          <Flexbox horizontal align={'center'} gap={6} key={key}>
            <SkeletonBar height={14} width={14} />
            <Text type={key === 'overview' ? undefined : 'secondary'}>
              {t(`devices.detail.tabs.${key}`)}
            </Text>
          </Flexbox>
        ))}
      </Flexbox>
      <div className={styles.detailGrid}>
        {DETAIL_CARDS.map((card, index) => (
          <section className={styles.detailCard} key={index}>
            <Flexbox horizontal align={'center'} className={styles.detailCardHeader} gap={8}>
              <SkeletonBar height={14} width={14} />
              <Text fontSize={13} weight={500}>
                {t(card.titleKey as any)}
              </Text>
            </Flexbox>
            {Array.from({ length: card.rows }, (_, row) => (
              <Flexbox
                horizontal
                align={'center'}
                className={styles.detailRow}
                justify={'space-between'}
                key={row}
              >
                {card.labels ? (
                  <Flexbox horizontal align={'center'} gap={8}>
                    <SkeletonBar height={14} width={14} />
                    <Text fontSize={13} type={'secondary'}>
                      {t(card.labels[row] as any)}
                    </Text>
                  </Flexbox>
                ) : (
                  <Line barHeight={13} height={28} width={160 + (row % 2) * 48} />
                )}
                <Line barHeight={13} height={28} width={card.labels ? 120 + (row % 3) * 32 : 48} />
              </Flexbox>
            ))}
          </section>
        ))}
      </div>
    </Flexbox>
  );
});

DeviceDetailSkeleton.displayName = 'DeviceDetailSkeleton';

/** Route fallback for the workspace devices page (visibility tabs + toolbar + grid). */
const DevicesPageSkeleton = () => <DevicesListSkeleton />;

export default DevicesPageSkeleton;
