import { Button, Tabs, Tooltip } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { CheckCheck } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { type PendingIntervention } from '../store/slices/data/pendingInterventions';
import { styles } from './style';
import { interventionTabLabelKey, numberDuplicateLabels } from './tabLabel';

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
    const { t } = useTranslation(['chat', 'plugin']);
    const labels = numberDuplicateLabels(
      interventions.map((item) => {
        const labelKey = interventionTabLabelKey(item);
        return labelKey ? t(labelKey, { defaultValue: item.apiName, ns: 'plugin' }) : item.apiName;
      }),
    );

    return (
      <div className={stylex.props(styles.tabBar).className}>
        <Tabs
          activeKey={String(activeIndex)}
          items={labels.map((label, index) => ({ key: String(index), label }))}
          size={'small'}
          onChange={(key) => onTabChange(Number(key))}
        />
        <div className={stylex.props(styles.tabTrailing).className}>
          <span className={stylex.props(styles.tabCounter).className}>
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
