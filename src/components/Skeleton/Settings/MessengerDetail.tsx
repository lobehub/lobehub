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
});

const isPlatform = (value: string | undefined): value is MessengerPlatform =>
  SUPPORTED_MESSENGER_PLATFORMS.some((platform) => platform.id === value);

/** A text placeholder centered in the line box of the text it stands in for. */
const Line = ({ bar, height, width }: { bar: number; height: number; width: number | string }) => (
  <Flexbox height={height} justify={'center'}>
    <SkeletonBar height={bar} width={width} />
  </Flexbox>
);

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
