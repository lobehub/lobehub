import { type UserStore } from '@/store/user';

import { currentSettings } from './settings';

/**
 * User-selectable approval modes (excludes 'headless' which is for backend async tasks only)
 */
type UserApprovalMode = 'auto-run' | 'allow-list' | 'manual';

const humanInterventionConfig = (s: UserStore) => currentSettings(s).tool?.humanIntervention || {};

const interventionApprovalMode = (s: UserStore): UserApprovalMode => {
  const mode = currentSettings(s).tool?.humanIntervention?.approvalMode;
  // Filter out 'headless' mode as it's not user-selectable (fallback to auto-run as similar behavior)
  if (mode === 'headless') return 'auto-run';
  return mode || 'manual';
};

const interventionAllowList = (s: UserStore) =>
  currentSettings(s).tool?.humanIntervention?.allowList || [];

export const toolInterventionSelectors = {
  allowList: interventionAllowList,
  approvalMode: interventionApprovalMode,
  config: humanInterventionConfig,
};
