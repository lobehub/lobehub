import type { UserGeneralConfig } from '@lobechat/types';

export const DEFAULT_COST_ESTIMATE_WARNING_THRESHOLD = 2;

export const DEFAULT_COMMON_SETTINGS: UserGeneralConfig = {
  animationMode: 'agile',
  // contextMenuMode not set default value, use env to calc
  costEstimateWarningThreshold: DEFAULT_COST_ESTIMATE_WARNING_THRESHOLD,
  fontSize: 14,
  highlighterTheme: 'lobe-theme',
  isDevMode: false,
  isLiteMode: false,
  mermaidTheme: 'lobe-theme',
  telemetry: true,
  transitionMode: 'fadeIn',
};
