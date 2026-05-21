import { DEFAULT_COST_ESTIMATE_WARNING_THRESHOLD } from '@lobechat/const';

import type { UserStore } from '../../../store';
import { currentSettings } from './settings';

const costEstimateWarningThreshold = (s: UserStore) =>
  currentSettings(s).general.costEstimateWarningThreshold ??
  DEFAULT_COST_ESTIMATE_WARNING_THRESHOLD;

export const userUsageSettingsSelectors = {
  costEstimateWarningThreshold,
};
