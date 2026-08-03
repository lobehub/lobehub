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
  /**
   * Batch-approval affordance. Omitted entirely by hosts that don't offer one.
   *
   * `count` is the active card's OWN parallel batch, which can be smaller than
   * the tab list: the tab list spans the whole conversation, so it may also
   * hold an abandoned approval from an earlier turn. Bundling count with the
   * handler makes "a button whose label counts calls it won't resolve"
   * unrepresentable.
   */
  approveAll?: { count: number; loading?: boolean; onApprove: () => void };
  interventions: PendingIntervention[];
  onTabChange: (index: number) => void;
}

const InterventionTabBar = memo<InterventionTabBarProps>(
  ({ interventions, activeIndex, approveAll, onTabChange }) => {
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
          {/* Only shown for a real batch: with one pending call in the active
              turn the per-card Submit already IS "approve all", and a second
              button beside it would just add a decision the user doesn't have
              to make. */}
          {approveAll && (
            <Tooltip title={t('tool.intervention.approveAllTooltip', { count: approveAll.count })}>
              <Button
                icon={CheckCheck}
                loading={approveAll.loading}
                size={'small'}
                type={'fill'}
                onClick={approveAll.onApprove}
              >
                {t('tool.intervention.approveAll', { count: approveAll.count })}
              </Button>
            </Tooltip>
          )}
        </div>
      </div>
    );
  },
);

export default InterventionTabBar;
