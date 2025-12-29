import { DraggablePanel, Flexbox } from '@lobehub/ui';
import { cssVar, useTheme } from 'antd-style';
import { Suspense, memo, useRef } from 'react';

import Detail from './Detail';
import DetailLoading from './Detail/Loading';
import List from './List';

export const PluginList = memo(() => {
  const ref = useRef<HTMLDivElement>(null);
  const theme = useTheme(); // Keep for colorBgContainerSecondary (not in cssVar)

  return (
    <Flexbox
      height={'75vh'}
      horizontal
      style={{
        borderTop: `1px solid ${cssVar.colorBorderSecondary}`,
        overflow: 'hidden',
        position: 'relative',
      }}
      width={'100%'}
    >
      <DraggablePanel maxWidth={1024} minWidth={420} placement={'left'}>
        <List />
      </DraggablePanel>
      <Flexbox
        height={'100%'}
        padding={16}
        ref={ref}
        style={{
          background: theme.colorBgContainerSecondary,
          overflowX: 'hidden',
          overflowY: 'auto',
        }}
        width={'100%'}
      >
        <Suspense fallback={<DetailLoading />}>
          <Detail />
        </Suspense>
      </Flexbox>
    </Flexbox>
  );
});

export default PluginList;
