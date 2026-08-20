import { DEFAULT_TOOL_APPROVAL_MODE } from '@lobechat/business-const';

import { type UserStore } from '@/store/user';

import { currentSettings } from './settings';

/**
 * User-selectable approval modes (excludes 'headless' which is for backend async tasks only)
 */
export type ApprovalMode = 'auto-run' | 'allow-list' | 'manual';

const humanInterventionConfig = (s: UserStore) => currentSettings(s).tool?.humanIntervention || {};

const interventionApprovalMode = (s: UserStore): ApprovalMode => {
  const mode = currentSettings(s).tool?.humanIntervention?.approvalMode;
  // Filter out 'headless' mode as it's not user-selectable (fallback to auto-run as similar behavior)
  if (mode === 'headless') return 'auto-run';
  // The distribution's default, not a literal: this is the mode a user gets
  // before they have expressed a preference, and what that should be depends on
  // who is running the deployment. Their own choice, once made, still wins.
  return mode || DEFAULT_TOOL_APPROVAL_MODE;
};

const interventionAllowList = (s: UserStore) =>
  currentSettings(s).tool?.humanIntervention?.allowList || [];

export const toolInterventionSelectors = {
  allowList: interventionAllowList,
  approvalMode: interventionApprovalMode,
  config: humanInterventionConfig,
};
