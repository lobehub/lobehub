'use client';

import type { BuiltinInterventionProps } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import type { RadioChangeEvent } from 'antd';
import { Radio } from 'antd';
import { createStaticStyles } from 'antd-style';
import { Trash2 } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ClearTodosParams } from '../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    padding: 12px;
    border-radius: ${cssVar.borderRadius};
    background: ${cssVar.colorFillTertiary};
  `,
  dangerText: css`
    font-size: 13px;
    color: ${cssVar.colorError};
  `,
  header: css`
    color: ${cssVar.colorWarning};
  `,
  label: css`
    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
  `,
  normalText: css`
    font-size: 13px;
  `,
}));

/**
 * ClearTodos Intervention component
 * Allows users to choose between clearing completed items or all items
 */
const ClearTodosIntervention = memo<BuiltinInterventionProps<ClearTodosParams>>(
  ({ args, onArgsChange }) => {
    const { t } = useTranslation('tool');
    const [mode, setMode] = useState<ClearTodosParams['mode']>(args?.mode || 'completed');

    const handleModeChange = useCallback(
      async (e: RadioChangeEvent) => {
        const newMode = e.target.value as ClearTodosParams['mode'];
        setMode(newMode);
        await onArgsChange?.({ mode: newMode });
      },
      [onArgsChange],
    );

    return (
      <Flexbox gap={12}>
        <Flexbox horizontal align="center" className={styles.header} gap={8}>
          <Trash2 size={16} />
          <span style={{ fontSize: 14, fontWeight: 500 }}>{t('lobe-gtd.clearTodos.header')}</span>
        </Flexbox>

        <Flexbox className={styles.container} gap={8}>
          <span className={styles.label}>{t('lobe-gtd.clearTodos.label')}</span>
          <Radio.Group value={mode} onChange={handleModeChange}>
            <Flexbox gap={8}>
              <Radio value="completed">
                <span className={styles.normalText}>
                  {t('lobe-gtd.clearTodos.option.completed')}
                </span>
              </Radio>
              <Radio value="all">
                <span className={styles.dangerText}>{t('lobe-gtd.clearTodos.option.all')}</span>
              </Radio>
            </Flexbox>
          </Radio.Group>
        </Flexbox>
      </Flexbox>
    );
  },
);

ClearTodosIntervention.displayName = 'ClearTodosIntervention';

export default ClearTodosIntervention;
