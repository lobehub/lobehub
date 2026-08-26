import { type UserStore } from '@/store/user';

import { currentSettings } from './settings';

/**
 * User-selectable approval modes (excludes 'headless' and 'reject', which are
 * backend-only modes for async tasks / untrusted headless runs such as an
 * Agent Share visitor run — see `UserInterventionConfig['approvalMode']`)
 */
export type ApprovalMode = 'auto-run' | 'allow-list' | 'manual';

const humanInterventionConfig = (s: UserStore) => currentSettings(s).tool?.humanIntervention || {};

const interventionApprovalMode = (s: UserStore): ApprovalMode => {
  const mode = currentSettings(s).tool?.humanIntervention?.approvalMode;
  // Filter out backend-only modes as they're not user-selectable (fallback to
  // auto-run as similar behavior)
  if (mode === 'headless' || mode === 'reject') return 'auto-run';
  return mode || 'manual';
};

const interventionAllowList = (s: UserStore) =>
  currentSettings(s).tool?.humanIntervention?.allowList || [];

export const toolInterventionSelectors = {
  allowList: interventionAllowList,
  approvalMode: interventionApprovalMode,
  config: humanInterventionConfig,
};
