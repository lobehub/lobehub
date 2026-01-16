'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { ClearTodosParams, ClearTodosState } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  mode: css`
    padding-block-end: 1px;
    color: ${cssVar.colorText};
    background: linear-gradient(to top, ${cssVar.colorWarningBg} 40%, transparent 40%);
  `,
}));

export const ClearTodosInspector = memo<BuiltinInspectorProps<ClearTodosParams, ClearTodosState>>(
  ({ args, partialArgs, isArgumentsStreaming }) => {
    const { t } = useTranslation('plugin');

    const mode = args?.mode || partialArgs?.mode;

    if (isArgumentsStreaming && !mode) {
      return (
        <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
          <span>{t('builtins.lobe-gtd.apiName.clearTodos')}</span>
        </div>
      );
    }

    const modeLabel =
      mode === 'all'
        ? t('builtins.lobe-gtd.apiName.clearTodos.modeAll')
        : t('builtins.lobe-gtd.apiName.clearTodos.modeCompleted');

    return (
      <div
        className={cx(inspectorTextStyles.root, isArgumentsStreaming && shinyTextStyles.shinyText)}
      >
        <Trans
          components={{ mode: <span className={styles.mode} /> }}
          i18nKey="builtins.lobe-gtd.apiName.clearTodos.result"
          ns="plugin"
          values={{ mode: modeLabel }}
        />
      </div>
    );
  },
);

ClearTodosInspector.displayName = 'ClearTodosInspector';

export default ClearTodosInspector;
