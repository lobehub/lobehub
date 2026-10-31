'use client';

import type { BuiltinInterventionProps } from '@lobechat/types';
import { Flexbox, RadioGroup } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Trash2 } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ClearTodosParams } from '../../types';

const styles = stylex.create({
  container: {
    padding: '12px',
    borderRadius: cssVar.borderRadius,
    background: cssVar.colorFillTertiary,
  },
  dangerText: { fontSize: '13px', color: cssVar.colorError },
  header: { color: cssVar.colorWarning },
  label: { fontSize: '13px', color: cssVar.colorTextSecondary },
  normalText: { fontSize: '13px' },
});

/**
 * ClearTodos Intervention component
 * Allows users to choose between clearing completed items or all items
 */
const ClearTodosIntervention = memo<BuiltinInterventionProps<ClearTodosParams>>(
  ({ args, onArgsChange }) => {
    const { t } = useTranslation('tool');
    const [mode, setMode] = useState<ClearTodosParams['mode']>(args?.mode || 'completed');

    const handleModeChange = useCallback(
      async (value: string) => {
        const newMode = value as ClearTodosParams['mode'];
        setMode(newMode);
        await onArgsChange?.({ mode: newMode });
      },
      [onArgsChange],
    );

    return (
      <Flexbox gap={12}>
        <Flexbox
          horizontal
          align="center"
          className={stylex.props(styles.header).className}
          gap={8}
        >
          <Trash2 size={16} />
          <span style={{ fontSize: 14, fontWeight: 500 }}>{t('lobe-agent.clearTodos.header')}</span>
        </Flexbox>

        <Flexbox className={stylex.props(styles.container).className} gap={8}>
          <span {...stylex.props(styles.label)}>{t('lobe-agent.clearTodos.label')}</span>
          <RadioGroup
            gap={8}
            horizontal={false}
            value={mode}
            options={[
              {
                label: (
                  <span {...stylex.props(styles.normalText)}>
                    {t('lobe-agent.clearTodos.option.completed')}
                  </span>
                ),
                value: 'completed',
              },
              {
                label: (
                  <span {...stylex.props(styles.dangerText)}>
                    {t('lobe-agent.clearTodos.option.all')}
                  </span>
                ),
                value: 'all',
              },
            ]}
            onChange={handleModeChange}
          />
        </Flexbox>
      </Flexbox>
    );
  },
);

ClearTodosIntervention.displayName = 'ClearTodosIntervention';

export default ClearTodosIntervention;
