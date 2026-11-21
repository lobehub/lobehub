'use client';

import { Flexbox, useTheme } from '@lobehub/ui';
import { type FC, type PropsWithChildren } from 'react';

const Container: FC<PropsWithChildren> = ({ children }) => {
  const theme = useTheme();

  return (
    <Flexbox
      flex={1}
      style={{
        background: theme.colorBgContainerSecondary,
        overflowY: 'auto',
        position: 'relative',
      }}
    >
      {children}
    </Flexbox>
  );
};

export default Container;
