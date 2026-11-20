'use client';

import { Block, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  type MessengerPlatform,
  PlatformAvatar,
  SUPPORTED_MESSENGER_PLATFORMS,
} from '@/features/Messenger/constants';
import CommandsSection from '@/features/Messenger/IntegrationDetail/CommandsSection';

import SkeletonBar from '../Bar';

const styles = stylex.create({
  // Same frame as the detail page's `card` (shared.tsx).
  card: {
    padding: '16px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorder,
    borderRadius: cssVar.borderRadius,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: {
      '@media (width <= 720px)': '1fr',
      'default': 'repeat(2, 1fr)',
    },
    gap: '12px',
  },
  listCard: {
    padding: '16px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
  },
});

const isPlatform = (value: string | undefined): value is MessengerPlatform =>
  SUPPORTED_MESSENGER_PLATFORMS.some((platform) => platform.id === value);

/** A text placeholder centered in the line box of the text it stands in for. */
const Line = ({ bar, height, width }: { bar: number; height: number; width: number | string }) => (
  <Flexbox height={height} justify={'center'}>
    <SkeletonBar height={bar} width={width} />
  </Flexbox>
);

/**
 * The platform cards of `IntegrationList`: a two-column grid (one column under
 * 720px) of outlined cards with a 48px avatar, a name + description stack and a
 * chevron. Which platforms the server offers is data, so the cards are bars.
 */
export const MessengerListGridSkeleton = ({ cards = 4 }: { cards?: number }) => (
  <div aria-busy data-testid={'messenger-list-skeleton'} {...stylex.props(styles.grid)}>
    {Array.from({ length: cards }, (_, index) => (
      <div key={index} {...stylex.props(styles.listCard)}>
        <Flexbox horizontal align={'center'} gap={16}>
          <SkeletonBar height={48} radius={'50%'} width={48} />
          <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
            <Line bar={15} height={24} width={88 + (index % 2) * 24} />
            <Line bar={12} height={22} width={'80%'} />
          </Flexbox>
          <SkeletonBar height={16} width={16} />
        </Flexbox>
      </div>
    ))}
  </div>
);

/** `/settings/messenger`: the subtitle (static copy) above the platform grid. */
export const MessengerListSkeleton = () => {
  const { t, ready } = useTranslation('messenger');

  return (
    <Flexbox gap={20}>
      {ready ? (
        <Text type={'secondary'}>{t('messenger.subtitle')}</Text>
      ) : (
        <Line bar={14} height={22} width={360} />
      )}
      <MessengerListGridSkeleton />
    </Flexbox>
  );
};

const ConnectionSkeleton = memo<{ withNestedContent?: boolean }>(({ withNestedContent }) => (
  <Block className={stylex.props(styles.card).className}>
    <Flexbox gap={12}>
      <Flexbox horizontal align="center" gap={12}>
        <SkeletonBar height={36} radius={8} width={36} />
        <Flexbox flex={1} gap={2}>
          <Line bar={12} height={20} width={64} />
          <Line bar={14} height={22} width={'36%'} />
        </Flexbox>
        <SkeletonBar height={22} width={72} />
        <SkeletonBar height={24} width={84} />
      </Flexbox>
      {withNestedContent && (
        <Flexbox horizontal gap={12} style={{ paddingInlineStart: 48 }}>
          {[0, 1].map((key) => (
            <Flexbox flex={1} gap={6} key={key}>
              <Line bar={12} height={20} width={56} />
              <SkeletonBar height={32} />
            </Flexbox>
          ))}
        </Flexbox>
      )}
    </Flexbox>
  </Block>
));
ConnectionSkeleton.displayName = 'MessengerConnectionSkeleton';

interface IntegrationDetailSkeletonProps {
  /** Static copy (name, avatar, description, commands) renders for a known platform. */
  platform?: string;
  /** Connections carry the scope + active-agent selects (every platform but Slack). */
  withNestedContent?: boolean;
}

/**
 * `DetailLayout` while the platform's connections load: back + name heading,
 * the platform card with its link button, one connection card and the static
 * Commands section, which renders for real since it needs no data.
 */
export const IntegrationDetailSkeleton = memo<IntegrationDetailSkeletonProps>(
  ({ platform, withNestedContent = false }) => {
    const { t } = useTranslation('messenger');
    const known = isPlatform(platform) ? platform : undefined;
    const name = SUPPORTED_MESSENGER_PLATFORMS.find((item) => item.id === known)?.name;

    return (
      <Flexbox aria-busy data-testid={'messenger-detail-skeleton'} gap={20}>
        <Flexbox horizontal align="center" gap={8}>
          <SkeletonBar height={16} width={16} />
          {name ? (
            <Text strong style={{ fontSize: 20 }}>
              {name}
            </Text>
          ) : (
            <Line bar={20} height={30} width={96} />
          )}
        </Flexbox>

        <Block className={stylex.props(styles.card).className}>
          <Flexbox horizontal align="center" gap={16}>
            {known ? (
              <PlatformAvatar platform={known} size={48} />
            ) : (
              <SkeletonBar height={48} radius={'50%'} width={48} />
            )}
            <Flexbox flex={1} gap={2}>
              {name ? (
                <Text strong style={{ fontSize: 15 }}>
                  {name}
                </Text>
              ) : (
                <Line bar={15} height={24} width={88} />
              )}
              {known ? (
                <Text style={{ fontSize: 13 }} type="secondary">
                  {t(`messenger.list.${known}.description` as any)}
                </Text>
              ) : (
                <Line bar={12} height={22} width={'60%'} />
              )}
            </Flexbox>
            <SkeletonBar height={32} width={120} />
          </Flexbox>
        </Block>

        <Flexbox gap={8}>
          <Text strong style={{ fontSize: 15 }}>
            {t('messenger.detail.connections.title')}
          </Text>
          <ConnectionSkeleton withNestedContent={withNestedContent} />
        </Flexbox>

        {known && <CommandsSection platform={known} />}
      </Flexbox>
    );
  },
);
IntegrationDetailSkeleton.displayName = 'MessengerIntegrationDetailSkeleton';

export const MessengerPlatformDetailSkeleton = ({ platform }: { platform: string }) => (
  <IntegrationDetailSkeleton platform={platform} withNestedContent={platform !== 'slack'} />
);
