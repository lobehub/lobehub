'use client';

import { type BlockProps } from '@lobehub/ui';
import { Block, Flexbox, Text } from '@lobehub/ui';
import { type ReactNode } from 'react';
import { memo } from 'react';

interface StatsFormGroupProps extends Omit<BlockProps, 'title'> {
  children: ReactNode;
  extra?: ReactNode;
  fontSize?: number;
  title?: string;
}

const StatsFormGroup = memo<StatsFormGroupProps>(
  ({ fontSize = 18, children, extra, title, ...rest }) => {
    return (
      <Block gap={16} variant={'borderless'} {...rest}>
        <Flexbox horizontal align={'center'} justify={'space-between'}>
          <Text fontSize={fontSize} weight={500}>
            {title}
          </Text>
          <Flexbox horizontal align={'center'} gap={8}>
            {extra}
          </Flexbox>
        </Flexbox>
        {children}
      </Block>
    );
  },
);

export default StatsFormGroup;
