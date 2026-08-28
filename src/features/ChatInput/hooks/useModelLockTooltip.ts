'use client';

import { useTranslation } from 'react-i18next';

import { formatLockedControlTooltip } from '../utils/lockedControlTooltip';
import type { AgentModelSelectionLockReason } from './useAgentModelSelection';

/**
 * Tooltip for a model trigger the caller cannot switch: the model name plus why
 * it is locked.
 *
 * Both chat model triggers (icon and label) share it so they cannot explain the
 * same lock differently. `useOnly` reuses the General-access copy the neighbour
 * workspace controls already show, keeping one wording for one permission.
 */
export const useModelLockTooltip = (
  displayName: string,
  lockReason?: AgentModelSelectionLockReason,
): string | undefined => {
  const { t } = useTranslation(['chat', 'setting']);

  if (!lockReason) return undefined;

  return formatLockedControlTooltip(
    displayName,
    lockReason === 'fixedByAgent'
      ? t('chat:input.modelFixedTip')
      : t('setting:permission.accessTag.useOnlyTip'),
  );
};
