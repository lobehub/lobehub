import { Block } from '@lobehub/ui';
import { type ReactNode } from 'react';

import { useDensity } from '@/styles/density';

interface StepStatusBoxProps {
  children: ReactNode;
}

const StepStatusBox = ({ children }: StepStatusBoxProps) => {
  const { compact } = useDensity();
  const size = compact ? 16 : 24;

  return (
    <Block
      horizontal
      align={'center'}
      flex={'none'}
      gap={4}
      height={size}
      justify={'center'}
      style={{ fontSize: compact ? 13 : 12 }}
      variant={compact ? 'borderless' : 'outlined'}
      width={size}
    >
      {children}
    </Block>
  );
};

export default StepStatusBox;
