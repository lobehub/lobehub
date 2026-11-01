import type { WidgetPreset } from '@lobechat/types';

import { countdown } from './countdown';
import { githubRepo } from './githubRepo';
import { hackerNews } from './hackerNews';
import { weatherNow } from './weatherNow';
import { yearProgress } from './yearProgress';

/**
 * Presets that ship with the app, so a self-hosted deployment without the
 * Market still has ready-made widgets. Keep this set small; the full catalog
 * lives in the Market.
 */
export const BUILTIN_WIDGET_PRESETS: readonly WidgetPreset[] = [
  weatherNow,
  countdown,
  yearProgress,
  githubRepo,
  hackerNews,
];

export const findBuiltinWidgetPreset = (id: string): WidgetPreset | undefined =>
  BUILTIN_WIDGET_PRESETS.find((preset) => preset.id === id);
