import { Tooltip } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { cx } from 'antd-style';
import { CheckCheck } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { type PendingIntervention } from '../store/slices/data/pendingInterventions';
import { styles } from './style';

interface InterventionTabBarProps {
  activeIndex: number;
  approveAllLoading?: boolean;
  interventions: PendingIntervention[];
  onApproveAll?: () => void;
  onTabChange: (index: number) => void;
}

const InterventionTabBar = memo<InterventionTabBarProps>(
  ({ interventions, activeIndex, approveAllLoading, onApproveAll, onTabChange }) => {
    const { t } = useTranslation('chat');

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
        <div className={styles.tabTrailing}>
          <span className={styles.tabCounter}>
            {activeIndex + 1} / {interventions.length}
          </span>
          {/* Only shown for a real batch: with one pending card the per-card
              Submit already IS "approve all", and a second button beside it
              would just add a decision the user doesn't have to make. */}
          {onApproveAll && (
            <Tooltip
              title={t('tool.intervention.approveAllTooltip', { count: interventions.length })}
            >
              <Button
                icon={CheckCheck}
                loading={approveAllLoading}
                size={'small'}
                type={'fill'}
                onClick={onApproveAll}
              >
                {t('tool.intervention.approveAll', { count: interventions.length })}
              </Button>
            </Tooltip>
          )}
        </div>
      </div>
    );
  },
);

export default InterventionTabBar;
