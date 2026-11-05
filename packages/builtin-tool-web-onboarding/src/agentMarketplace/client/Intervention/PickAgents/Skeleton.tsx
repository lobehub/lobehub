import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import { styles } from './style';

const TABBAR_ITEMS = 6;
const CARD_ITEMS = 6;

const PickAgentsSkeleton = memo(() => (
  <div {...stylex.props(styles.container)}>
    <div {...stylex.props(styles.tabBar)}>
      {Array.from({ length: TABBAR_ITEMS }).map((_, i) => (
        <div {...stylex.props(styles.skeletonTabBarItem)} key={i} />
      ))}
    </div>
    <div {...stylex.props(styles.content)}>
      <div {...stylex.props(styles.grid)}>
        {Array.from({ length: CARD_ITEMS }).map((_, i) => (
          <div {...stylex.props(styles.skeletonCard)} key={i}>
            <div {...stylex.props(styles.cardHeader)}>
              <div {...stylex.props(styles.skeletonAvatar)} />
              <div className={stylex.props(styles.skeletonLine).className} style={{ flex: 1 }} />
            </div>
            <div className={stylex.props(styles.skeletonLine).className} style={{ width: '90%' }} />
            <div className={stylex.props(styles.skeletonLine).className} style={{ width: '75%' }} />
          </div>
        ))}
      </div>
    </div>
  </div>
));

PickAgentsSkeleton.displayName = 'PickAgentsSkeleton';

export default PickAgentsSkeleton;
