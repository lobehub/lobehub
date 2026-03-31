'use client';

import { Flexbox } from '@lobehub/ui';
import { type PropsWithChildren } from 'react';
import { memo } from 'react';

import MemoryAnalysis from '../MemoryAnalysis';
import PurgeButton from './PurgeButton';

interface Props extends PropsWithChildren {
  gap?: number;
  showAnalysis?: boolean;
  showPurge?: boolean;
}

const ActionBar = memo<Props>(({ children, gap = 8, showAnalysis, showPurge }) => {
  return (
    <Flexbox horizontal gap={gap}>
      {showPurge && <PurgeButton iconOnly />}
      {showAnalysis && <MemoryAnalysis iconOnly />}
      {children}
    </Flexbox>
  );
});

ActionBar.displayName = 'MemoryActionBar';

export default ActionBar;
export { default as PurgeButton } from './PurgeButton';
