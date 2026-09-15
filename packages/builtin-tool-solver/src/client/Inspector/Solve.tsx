'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { Text } from '@lobehub/ui/base-ui';
import { cssVar, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { SolveParams, SolveState } from '../../types';
import { formatCost } from '../utils';

const STATUS_KEY = {
  error: 'error',
  feasible_timeout: 'feasibleTimeout',
  infeasible: 'infeasible',
  optimal: 'optimal',
} as const;

export const SolveInspector = memo<BuiltinInspectorProps<SolveParams, SolveState>>(
  ({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
    const { t } = useTranslation('plugin');

    const pack = args?.pack || partialArgs?.pack || '';
    const inProgress = isArgumentsStreaming || isLoading;

    if (isArgumentsStreaming && !pack) {
      return (
        <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
          <span>{t('builtins.builtin-solver.apiName.solve.loading', { pack: '…' })}</span>
        </div>
      );
    }

    const status = pluginState?.status;
    const bestCandidate = pluginState?.candidates?.[0];
    const conflictCount = pluginState?.conflicts?.length ?? 0;

    return (
      <div className={cx(inspectorTextStyles.root, inProgress && shinyTextStyles.shinyText)}>
        <span>
          {t(
            inProgress
              ? 'builtins.builtin-solver.apiName.solve.loading'
              : 'builtins.builtin-solver.apiName.solve.completed',
            { pack },
          )}
        </span>
        {!inProgress && status && (
          <>
            <span>:&nbsp;</span>
            <span className={highlightTextStyles.primary}>
              {t(`builtins.builtin-solver.inspector.status.${STATUS_KEY[status]}`)}
            </span>
            {(status === 'optimal' || status === 'feasible_timeout') &&
              typeof bestCandidate?.totalCost === 'number' && (
                <Text as={'span'} style={{ color: cssVar.colorTextSecondary, fontSize: 12 }}>
                  &nbsp;({formatCost(bestCandidate.totalCost)})
                </Text>
              )}
            {status === 'infeasible' && conflictCount > 0 && (
              <Text as={'span'} style={{ color: cssVar.colorTextSecondary, fontSize: 12 }}>
                &nbsp;({t('builtins.builtin-solver.inspector.conflicts', { count: conflictCount })})
              </Text>
            )}
          </>
        )}
      </div>
    );
  },
);
SolveInspector.displayName = 'SolveInspector';
export default SolveInspector;
