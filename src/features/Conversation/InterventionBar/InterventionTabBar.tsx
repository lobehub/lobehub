import { cx } from 'antd-style';
import { memo } from 'react';

import { type PendingIntervention } from '../store/slices/data/pendingInterventions';
import { styles } from './style';

interface InterventionTabBarProps {
  activeIndex: number;
  interventions: PendingIntervention[];
  onTabChange: (index: number) => void;
}

const InterventionTabBar = memo<InterventionTabBarProps>(
  ({ interventions, activeIndex, onTabChange }) => {
    return (
      <div className={styles.tabBar}>
        {interventions.map((item, index) => (
          <div
            className={cx(styles.tab, index === activeIndex && styles.tabActive)}
            key={item.toolCallId}
            onClick={() => onTabChange(index)}
          >
            🔧 {item.apiName}
          </div>
        ))}
        <div className={styles.tabCounter}>
          {activeIndex + 1} / {interventions.length}
        </div>
      </div>
    );
  },
);

export default InterventionTabBar;
