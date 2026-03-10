'use client';

import { Flexbox } from '@lobehub/ui';
import { useTheme } from 'antd-style';
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
