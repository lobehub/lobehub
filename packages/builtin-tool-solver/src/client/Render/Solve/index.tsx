'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Alert } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { SolveParams, SolveState } from '../../../types';
import CandidateList from './CandidateList';
import InfeasibleResult from './InfeasibleResult';

/**
 * Rich result card for builtin-solver solve calls:
 * - optimal / feasible_timeout → candidate plans with key facts (feasible_timeout
 *   is visibly marked as best-within-time-limit, not proven optimal)
 * - infeasible → the conflicting constraints mapped back to spec fields, with
 *   explanations and suggested relaxations
 * - error → the spec validation violations (a repair signal, not a crash)
 */
const SolveRender = memo<BuiltinRenderProps<SolveParams, SolveState>>(
  ({ args, pluginState, pluginError }) => {
    const { t } = useTranslation('plugin');

    if (pluginError) {
      return <Alert title={pluginError?.message} type={'error'} />;
    }

    if (!pluginState) return null;

    switch (pluginState.status) {
      case 'optimal':
      case 'feasible_timeout': {
        return (
          <Flexbox gap={8} style={{ paddingBlock: 4 }}>
            {pluginState.status === 'feasible_timeout' && (
              <Alert
                type={'info'}
                title={t('builtins.builtin-solver.render.feasibleTimeoutNotice', {
                  ms: pluginState.solverMeta?.timeLimitMs,
                })}
              />
            )}
            <CandidateList
              candidates={pluginState.candidates ?? []}
              spec={args?.spec}
              status={pluginState.status}
            />
          </Flexbox>
        );
      }
      case 'infeasible': {
        return (
          <Flexbox gap={8} style={{ paddingBlock: 4 }}>
            <Alert title={t('builtins.builtin-solver.render.infeasibleTitle')} type={'warning'} />
            <InfeasibleResult conflicts={pluginState.conflicts ?? []} />
          </Flexbox>
        );
      }
      case 'error': {
        return (
          <Flexbox style={{ paddingBlock: 4 }}>
            <Alert
              extra={pluginState.error}
              title={t('builtins.builtin-solver.render.errorTitle')}
              type={'error'}
            />
          </Flexbox>
        );
      }
      default: {
        return null;
      }
    }
  },
);
SolveRender.displayName = 'SolveRender';

export default SolveRender;
