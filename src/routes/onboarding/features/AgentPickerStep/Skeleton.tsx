import { memo } from 'react';

import { styles } from './style';

const CARD_COUNT = 6;
const PILL_COUNT = 4;

const AgentPickerSkeleton = memo(() => (
  <>
    <div className={styles.filterBar}>
      {Array.from({ length: PILL_COUNT }).map((_, index) => (
        <div className={styles.skeletonPill} key={index} />
      ))}
    </div>
    <div className={styles.grid}>
      {Array.from({ length: CARD_COUNT }).map((_, index) => (
        <div className={styles.skeletonCard} key={index}>
          <div className={styles.skeletonAvatar} />
          <div style={{ display: 'flex', flex: 1, flexDirection: 'column', gap: 8, paddingTop: 4 }}>
            <div className={styles.skeletonLine} style={{ width: '60%' }} />
            <div className={styles.skeletonLine} style={{ width: '90%' }} />
          </div>
        </div>
      ))}
    </div>
  </>
));

AgentPickerSkeleton.displayName = 'AgentPickerSkeleton';

export default AgentPickerSkeleton;
