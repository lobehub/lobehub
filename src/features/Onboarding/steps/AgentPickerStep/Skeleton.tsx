import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import { sx } from '@/styles/sx';

import { styles } from './style';

const CARD_COUNT = 6;
const PILL_COUNT = 4;

const AgentPickerSkeleton = memo(() => (
  <>
    <div {...stylex.props(styles.filterBar)}>
      {Array.from({ length: PILL_COUNT }).map((_, index) => (
        <div {...stylex.props(styles.skeletonPill)} key={index} />
      ))}
    </div>
    <div {...stylex.props(styles.grid)}>
      {Array.from({ length: CARD_COUNT }).map((_, index) => (
        <div {...stylex.props(styles.skeletonCard)} key={index}>
          <div {...stylex.props(styles.skeletonAvatar)} />
          <div style={{ display: 'flex', flex: 1, flexDirection: 'column', gap: 8, paddingTop: 4 }}>
            <div {...sx([styles.skeletonLine], undefined, { width: '60%' })} />
            <div {...sx([styles.skeletonLine], undefined, { width: '90%' })} />
          </div>
        </div>
      ))}
    </div>
  </>
));

AgentPickerSkeleton.displayName = 'AgentPickerSkeleton';

export default AgentPickerSkeleton;
