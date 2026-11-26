'use client';

import { type FlexboxProps } from '@lobehub/ui';
import { Flexbox } from '@lobehub/ui';

import { useDensityTokens, usePanelDensityTokens } from '@/styles/density';

import SkeletonBar from '../Bar';

export const SkeletonItem = ({
  padding,
  height,
  style,
  avatarSize,
  ...rest
}: { avatarSize?: number } & Omit<FlexboxProps, 'children'>) => {
  const panel = usePanelDensityTokens();
  const barHeight = panel ? panel.fontSize + 2 : 16;

  return (
    <Flexbox
      horizontal
      align={'center'}
      flex={1}
      gap={panel?.gap ?? 8}
      height={height ?? panel?.rowHeight ?? 36}
      padding={padding ?? (panel ? `0 ${panel.paddingInline + 2}px` : 6)}
      style={style}
      {...rest}
    >
      <SkeletonBar
        height={avatarSize ?? panel?.iconBox ?? 28}
        width={avatarSize ?? panel?.iconBox ?? 28}
      />
      <Flexbox flex={1} height={barHeight}>
        <SkeletonBar height={barHeight} />
      </Flexbox>
    </Flexbox>
  );
};

export const SkeletonList = ({
  compact,
  rows = 3,
  ...rest
}: { compact?: boolean; rows?: number } & Omit<FlexboxProps, 'children'>) => {
  const density = useDensityTokens();

  return (
    <Flexbox gap={compact ? 1 : 2} {...rest}>
      {Array.from({ length: rows }).map((_, index) =>
        compact ? (
          <SkeletonItem
            avatarSize={density.iconSize}
            flex={'none'}
            gap={density.gap}
            height={density.rowHeight}
            key={index}
            padding={`8px ${density.paddingInline}px`}
          />
        ) : (
          <SkeletonItem key={index} />
        ),
      )}
    </Flexbox>
  );
};

export default SkeletonList;
