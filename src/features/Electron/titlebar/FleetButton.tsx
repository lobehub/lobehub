'use client';

import { ActionIcon } from '@lobehub/ui';
import { LayersIcon } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

/**
 * Titlebar entry point for the Fleet View — opens the side-by-side agent
 * dashboard. Sits next to the device/connection status icons.
 *
 * Gated behind the `enableFleet` lab flag (Settings → Advanced → Labs);
 * hidden by default until the user opts in.
 */
const FleetButton = memo(() => {
  const { t } = useTranslation('electron');
  const navigate = useWorkspaceAwareNavigate();
  const enableFleet = useUserStore(labPreferSelectors.enableFleet);

  const handleClick = useCallback(() => {
    navigate('/fleet');
  }, [navigate]);

  if (!enableFleet) return null;

  return (
    <ActionIcon
      icon={LayersIcon}
      size={'small'}
      title={t('fleet.tooltip')}
      tooltipProps={{ placement: 'bottomRight' }}
      onClick={handleClick}
    />
  );
});

FleetButton.displayName = 'FleetButton';

export default FleetButton;
