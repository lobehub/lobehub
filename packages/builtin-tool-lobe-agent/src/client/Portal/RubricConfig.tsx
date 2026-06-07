'use client';

import { DEFAULT_MAX_REPAIR_ROUNDS } from '@lobechat/types';
import { Flexbox, Icon, InputNumber } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { RefreshCw } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useRubric } from '@/features/Verify/hooks';
import { useVerifyStore, verifySelectors } from '@/store/verify';

const styles = createStaticStyles(({ css, cssVar }) => ({
  desc: css`
    font-size: 12px;
    line-height: 1.5;
    color: ${cssVar.colorTextTertiary};
  `,
  fieldIcon: css`
    color: ${cssVar.colorTextTertiary};
  `,
  fieldLabel: css`
    font-size: 13px;
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};
  `,
  row: css`
    padding: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
  `,
  rowTitle: css`
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
}));

interface RubricConfigProps {
  rubricId: string;
}

/**
 * The right-side config panel for the rubric (delivery-standard) run policy.
 * Currently exposes `maxRepairRounds` — the cap on automatic repair iterations
 * before a failing run stops. Writes through the verify store (optimistic +
 * debounced) so the edit is reflected immediately and persisted to the rubric.
 */
const RubricConfig = memo<RubricConfigProps>(({ rubricId }) => {
  const { t } = useTranslation('plugin');

  const { data: rubric } = useRubric(rubricId);
  const updateRubricConfig = useVerifyStore((s) => s.updateRubricConfig);
  const edit = useVerifyStore(verifySelectors.rubricConfigEdit(rubricId));

  const maxRepairRounds =
    edit.maxRepairRounds ?? rubric?.config?.maxRepairRounds ?? DEFAULT_MAX_REPAIR_ROUNDS;

  return (
    <Flexbox gap={16} paddingBlock={16} style={{ height: '100%' }}>
      <Flexbox horizontal align="center" className={styles.row} gap={12} justify="space-between">
        <Flexbox gap={2} style={{ minWidth: 0 }}>
          <Flexbox horizontal align="center" gap={6}>
            <Icon className={styles.fieldIcon} icon={RefreshCw} size={14} />
            <span className={styles.rowTitle}>
              {t('builtins.lobe-agent.verifyPlan.portal.rubric.maxRepairRounds.title')}
            </span>
          </Flexbox>
          <span className={styles.desc}>
            {t('builtins.lobe-agent.verifyPlan.portal.rubric.maxRepairRounds.desc')}
          </span>
        </Flexbox>
        <InputNumber
          max={5}
          min={0}
          step={1}
          style={{ flex: 'none', width: 80 }}
          value={maxRepairRounds}
          onChange={(value) => {
            if (typeof value === 'number') updateRubricConfig(rubricId, { maxRepairRounds: value });
          }}
        />
      </Flexbox>
    </Flexbox>
  );
});

RubricConfig.displayName = 'RubricConfig';

export default RubricConfig;
