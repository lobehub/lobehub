'use client';

import { type BlockProps } from '@lobehub/ui';
import { Block, Flexbox, Text } from '@lobehub/ui';
import { type ReactNode } from 'react';
import { memo } from 'react';

interface StatsFormGroupProps extends Omit<BlockProps, 'title'> {
  afterTitle?: ReactNode;
  children: ReactNode;
  extra?: ReactNode;
  fontSize?: number;
  title?: string;
}

const StatsFormGroup = memo<StatsFormGroupProps>(
  ({ fontSize = 18, afterTitle, children, extra, title, ...rest }) => {
    return (
      <Block gap={16} variant={'borderless'} {...rest}>
        <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
          <Flexbox horizontal align={'center'} flex={1} gap={8} style={{ minWidth: 0 }}>
            <Text fontSize={fontSize} weight={500}>
              {title}
            </Text>
            {afterTitle}
          </Flexbox>
          <Flexbox horizontal align={'center'} flex={'none'} gap={8}>
            {extra}
          </Flexbox>
        </Flexbox>
        {children}
      </Block>
    );
  },
);

export default StatsFormGroup;
