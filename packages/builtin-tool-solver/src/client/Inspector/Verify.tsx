'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { Text } from '@lobehub/ui/base-ui';
import { cssVar, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { VerifyParams, VerifyState } from '../../types';

export const VerifyInspector = memo<BuiltinInspectorProps<VerifyParams, VerifyState>>(
  ({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
    const { t } = useTranslation('plugin');

    const pack = args?.pack || partialArgs?.pack || '';
    const inProgress = isArgumentsStreaming || isLoading;

    if (isArgumentsStreaming && !pack) {
      return (
        <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
          <span>{t('builtins.builtin-solver.apiName.verify.loading')}</span>
        </div>
      );
    }

    return (
      <div className={cx(inspectorTextStyles.root, inProgress && shinyTextStyles.shinyText)}>
        <span>
          {t(
            inProgress
              ? 'builtins.builtin-solver.apiName.verify.loading'
              : 'builtins.builtin-solver.apiName.verify.completed',
          )}
        </span>
        {!inProgress && pluginState && (
          <>
            <span>:&nbsp;</span>
            <span className={highlightTextStyles.primary}>
              {t(
                pluginState.pass
                  ? 'builtins.builtin-solver.inspector.verifyPass'
                  : 'builtins.builtin-solver.inspector.verifyFail',
              )}
            </span>
            <Text as={'span'} style={{ color: cssVar.colorTextSecondary, fontSize: 12 }}>
              &nbsp;({pluginState.passed}/{pluginState.total})
            </Text>
          </>
        )}
      </div>
    );
  },
);
VerifyInspector.displayName = 'VerifyInspector';
export default VerifyInspector;
