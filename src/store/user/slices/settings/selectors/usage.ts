import { DEFAULT_USAGE_SETTINGS } from '@lobechat/const';

import { type UserStore } from '../../../store';
import { currentSettings } from './settings';

const usageSettings = (s: UserStore) => currentSettings(s).usage || DEFAULT_USAGE_SETTINGS;

const costEstimateWarningThreshold = (s: UserStore) =>
  usageSettings(s).costEstimateWarningThreshold;

export const userUsageSettingsSelectors = {
  costEstimateWarningThreshold,
  usageSettings,
};
