'use client';

import { useTheme } from 'antd-style';
import { PropsWithChildren, memo } from 'react';
import { Flexbox } from 'react-layout-kit';

const Container = memo<PropsWithChildren>(({ children }) => {
  const theme = useTheme();

  return (
    <Flexbox
      flex={1}
      style={{
        background: theme.colorBgContainerSecondary,
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {children}
    </Flexbox>
  );
});

Container.displayName = 'Container';

export default Container;
