import { useState } from 'react';

import { rendererOtaService } from '@/services/electron/rendererOta';

import { useAutoDismiss } from './useAutoDismiss';

export const APPLIED_NOTICE_DURATION = 3000;

/**
 * State for the "updated to version" toast. The main process keeps the applied
 * version until told otherwise, so every way the toast closes (timeout or Ignore)
 * clears it there too; otherwise a remount, such as a workspace switch, shows it again.
 * `hidden` pauses the countdown while a pending update takes the toast's slot.
 */
export const useAppliedNotice = (hidden: boolean) => {
  const [appliedVersion, setAppliedVersion] = useState<string | null>(null);

  const dismiss = () => {
    setAppliedVersion(null);
    rendererOtaService.dismissAppliedNotice().catch(console.error);
  };

  const hoverHandlers = useAutoDismiss(
    hidden ? null : appliedVersion,
    dismiss,
    APPLIED_NOTICE_DURATION,
  );

  return { appliedVersion, dismiss, hoverHandlers, setAppliedVersion };
};
