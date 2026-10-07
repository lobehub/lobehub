'use client';

import { type EvalRunConfig } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { styles } from './style';

interface RunConfigProps {
  caseCount: number;
  config?: EvalRunConfig | null;
  targetCount: number;
}

/**
 * How the run was executed, read straight off the stored run config — what a
 * reader needs to trust the grid below: who judged it, the pass bar, and the
 * request overrides every model received.
 */
const RunConfig = memo<RunConfigProps>(({ caseCount, config, targetCount }) => {
  const { t } = useTranslation('eval');
  const options = config?.replayOptions;
  const unset = t('comparison.config.default');

  const items: Array<{ label: string; value: ReactNode }> = [
    { label: t('comparison.config.mode'), value: config?.executionMode ?? 'replay' },
    {
      label: t('comparison.config.judge'),
      value:
        config?.judgeProvider && config?.judgeModel
          ? `${config.judgeProvider}/${config.judgeModel}`
          : unset,
    },
    {
      label: t('comparison.config.passThreshold'),
      value: typeof config?.passThreshold === 'number' ? config.passThreshold : unset,
    },
    {
      label: t('comparison.config.temperature'),
      value: options?.temperature ?? unset,
    },
    { label: t('comparison.config.maxTokens'), value: options?.maxTokens ?? unset },
    {
      label: t('comparison.config.withTools'),
      value:
        options?.withTools === false
          ? t('comparison.config.withTools.off')
          : t('comparison.config.withTools.on'),
    },
    {
      label: t('comparison.config.grid'),
      value: t('comparison.config.gridValue', { cases: caseCount, models: targetCount }),
    },
  ];

  return (
    <Flexbox className={styles.card} gap={12} padding={16}>
      <span className={styles.label}>{t('comparison.config.title')}</span>
      <div
        style={{
          display: 'grid',
          gap: 12,
          gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
        }}
      >
        {items.map((item) => (
          <Flexbox className={styles.configItem} gap={4} key={item.label}>
            <span className={styles.configLabel}>{item.label}</span>
            <span className={styles.configValue} title={String(item.value)}>
              {item.value}
            </span>
          </Flexbox>
        ))}
      </div>
    </Flexbox>
  );
});

RunConfig.displayName = 'EvalComparisonRunConfig';

export default RunConfig;
