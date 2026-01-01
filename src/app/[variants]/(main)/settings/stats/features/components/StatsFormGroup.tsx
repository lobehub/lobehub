'use client';

import { Block, type BlockProps, Flexbox, Text } from '@lobehub/ui';
import { type ReactNode, memo } from 'react';

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
        <Flexbox align={'center'} horizontal justify={'space-between'}>
          <Text fontSize={fontSize} weight={500}>
            {title}
          </Text>
          <Flexbox align={'center'} gap={8} horizontal>
            {extra}
          </Flexbox>
        </Flexbox>
        {children}
      </Block>
    );
  },
);

export default StatsFormGroup;
