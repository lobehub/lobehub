'use client';

import { Block, Flexbox, Skeleton } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

const styles = stylex.create({
  card: {
    padding: '16px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorder,
    borderRadius: cssVar.borderRadius,
  },
});

const ConnectionsSkeleton = memo<{ withNestedContent?: boolean }>(
  ({ withNestedContent = false }) => (
    <Flexbox gap={12}>
      {Array.from({ length: 2 }).map((_, index) => (
        <Block className={stylex.props(styles.card).className} key={index}>
          <Flexbox gap={12}>
            <Flexbox horizontal align="center" gap={12}>
              <Skeleton.Avatar shape={'square'} size={36} />
              <Flexbox flex={1} gap={6}>
                <Skeleton height={28} width={56} />
                <Skeleton height={18} width={'40%'} />
              </Flexbox>
              <Skeleton height={28} width={72} />
              <Skeleton height={28} width={84} />
            </Flexbox>
            {withNestedContent && (
              <Flexbox gap={6} style={{ paddingInlineStart: 48 }}>
                <Skeleton height={28} width={72} />
                <Skeleton height={32} width={'100%'} />
              </Flexbox>
            )}
          </Flexbox>
        </Block>
      ))}
    </Flexbox>
  ),
);
ConnectionsSkeleton.displayName = 'MessengerConnectionsSkeleton';

export const IntegrationDetailSkeleton = memo<{ withNestedContent?: boolean }>(
  ({ withNestedContent = false }) => (
    <Flexbox gap={20}>
      <Flexbox horizontal align="center" gap={12}>
        <Skeleton height={28} width={20} />
        <Skeleton height={28} width={96} />
      </Flexbox>

      <Block className={stylex.props(styles.card).className}>
        <Flexbox horizontal align="center" gap={16}>
          <Skeleton.Avatar shape={'square'} size={48} />
          <Flexbox flex={1} gap={6}>
            <Skeleton height={28} width={64} />
            <Skeleton.Text rows={1} width={'65%'} />
          </Flexbox>
          <Skeleton height={40} width={120} />
        </Flexbox>
      </Block>

      <Flexbox gap={8}>
        <Skeleton height={28} width={72} />
        <ConnectionsSkeleton withNestedContent={withNestedContent} />
      </Flexbox>
    </Flexbox>
  ),
);
IntegrationDetailSkeleton.displayName = 'MessengerIntegrationDetailSkeleton';

export const MessengerPlatformDetailSkeleton = ({ platform }: { platform: string }) => (
  <IntegrationDetailSkeleton withNestedContent={platform !== 'slack'} />
);
