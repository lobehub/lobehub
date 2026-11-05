'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { memo, type ReactNode } from 'react';

export interface SettingRowProps {
  children?: ReactNode;
  description?: ReactNode;
  title: ReactNode;
}

const SettingRow = memo<SettingRowProps>(({ title, description, children }) => {
  return (
    <Flexbox horizontal align={'center'} gap={16} justify={'space-between'}>
      <Flexbox allowShrink gap={2}>
        <Text weight={500}>{title}</Text>
        {description && (
          <Text fontSize={13} type={'secondary'}>
            {description}
          </Text>
        )}
      </Flexbox>
      {children}
    </Flexbox>
  );
});

export default SettingRow;
