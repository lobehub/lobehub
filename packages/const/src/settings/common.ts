import type { UserGeneralConfig } from '@lobechat/types';

export const DEFAULT_COST_ESTIMATE_WARNING_THRESHOLD = 0.5;

export const DEFAULT_COMMON_SETTINGS: UserGeneralConfig = {
  animationMode: 'agile',
  costEstimateWarningThreshold: DEFAULT_COST_ESTIMATE_WARNING_THRESHOLD,
  fontSize: 14,
  highlighterTheme: 'lobe-theme',
  interfaceDensity: 'loose',
  isLiteMode: false,
  mermaidTheme: 'lobe-theme',
  telemetry: true,
  transitionMode: 'fadeIn',
};
