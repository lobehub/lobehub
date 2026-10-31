'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { ClearTodosParams, ClearTodosState } from '../../../types';

const styles = stylex.create({
  mode: {
    paddingBlockEnd: '1px',
    color: cssVar.colorText,
    background: `linear-gradient(to top, ${cssVar.colorWarningBg} 40%, transparent 40%)`,
  },
});

export const ClearTodosInspector = memo<BuiltinInspectorProps<ClearTodosParams, ClearTodosState>>(
  ({ args, partialArgs, isArgumentsStreaming }) => {
    const { t } = useTranslation('plugin');

    const mode = args?.mode || partialArgs?.mode;

    if (isArgumentsStreaming && !mode) {
      return (
        <div className={inspectorTextStyles.root}>
          <span className={shinyTextStyles.shinyText}>
            {t('builtins.lobe-agent.apiName.clearTodos')}
          </span>
        </div>
      );
    }

    const modeLabel =
      mode === 'all'
        ? t('builtins.lobe-agent.apiName.clearTodos.modeAll')
        : t('builtins.lobe-agent.apiName.clearTodos.modeCompleted');

    return (
      <div
        className={cx(inspectorTextStyles.root, isArgumentsStreaming && shinyTextStyles.shinyText)}
      >
        <Trans
          components={{ mode: <span {...stylex.props(styles.mode)} /> }}
          i18nKey="builtins.lobe-agent.apiName.clearTodos.result"
          ns="plugin"
          values={{ mode: modeLabel }}
        />
      </div>
    );
  },
);

ClearTodosInspector.displayName = 'ClearTodosInspector';

export default ClearTodosInspector;
