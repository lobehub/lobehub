import { memo } from 'react';

import { styles } from './style';

const SIDEBAR_ITEMS = 6;
const CARD_ITEMS = 6;

const PickAgentsSkeleton = memo(() => (
  <div className={styles.container}>
    <div className={styles.sidebar}>
      {Array.from({ length: SIDEBAR_ITEMS }).map((_, i) => (
        <div className={styles.skeletonSidebarItem} key={i} />
      ))}
    </div>
    <div className={styles.content}>
      <div className={styles.grid}>
        {Array.from({ length: CARD_ITEMS }).map((_, i) => (
          <div className={styles.skeletonCard} key={i}>
            <div className={styles.skeletonAvatar} />
            <div className={styles.skeletonLine} style={{ width: '60%' }} />
            <div className={styles.skeletonLine} style={{ width: '90%' }} />
            <div className={styles.skeletonLine} style={{ width: '75%' }} />
          </div>
        ))}
      </div>
    </div>
  </div>
));

PickAgentsSkeleton.displayName = 'PickAgentsSkeleton';

export default PickAgentsSkeleton;
