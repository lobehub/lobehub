'use client';

import { Segmented } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { LOBE_BENCH_PATH } from '@/features/LobeBench/lobeBench';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

export type EvalArea = 'agent' | 'bench';

/**
 * The switch between the two eval areas: "Agent Eval" tests the user's own
 * Agents on their own cases; "Lobe Bench" compares models on LobeHub's
 * standard cases. Both live under `/eval`.
 */
const AreaSwitch = memo<{ active: EvalArea }>(({ active }) => {
  const { t } = useTranslation('eval');
  const navigate = useWorkspaceAwareNavigate();

  return (
    <Segmented
      size={'small'}
      value={active}
      options={[
        { label: t('lobeBench.switch.agent'), value: 'agent' },
        { label: t('lobeBench.switch.bench'), value: 'bench' },
      ]}
      onChange={(value) => navigate(value === 'bench' ? LOBE_BENCH_PATH : '/eval')}
    />
  );
});

AreaSwitch.displayName = 'EvalAreaSwitch';

export default AreaSwitch;
