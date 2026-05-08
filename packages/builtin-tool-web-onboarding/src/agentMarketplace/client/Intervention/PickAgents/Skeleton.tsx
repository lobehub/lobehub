import { memo } from 'react';

import { styles } from './style';

const TABBAR_ITEMS = 6;
const CARD_ITEMS = 6;

const PickAgentsSkeleton = memo(() => (
  <div className={styles.container}>
    <div className={styles.tabBar}>
      {Array.from({ length: TABBAR_ITEMS }).map((_, i) => (
        <div className={styles.skeletonTabBarItem} key={i} />
      ))}
    </div>
    <div className={styles.content}>
      <div className={styles.grid}>
        {Array.from({ length: CARD_ITEMS }).map((_, i) => (
          <div className={styles.skeletonCard} key={i}>
            <div className={styles.cardHeader}>
              <div className={styles.skeletonAvatar} />
              <div className={styles.skeletonLine} style={{ flex: 1 }} />
            </div>
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
