// ============================================
// Widget presets — ready-made widgets to install
// ============================================
//
// A preset is a complete widget (script, manifest with its params, view) plus
// what a gallery needs to show it before anything runs: a sample output, a
// category and a default size. Bundled presets ship with the app for
// self-hosted deployments; the rest are published to the Market.

import type {
  WidgetManifest,
  WidgetOutput,
  WidgetOutputType,
  WidgetRuntime,
  WidgetView,
} from './index';

export const WIDGET_PRESET_CATEGORIES = [
  'time',
  'weather',
  'dev',
  'life',
  'finance',
  'content',
  'business',
] as const;
export type WidgetPresetCategory = (typeof WIDGET_PRESET_CATEGORIES)[number];

/** Translated gallery copy; the preset's own fields are English. */
export interface WidgetPresetLocale {
  description?: string;
  /** Param labels and descriptions, keyed by param name. */
  params?: Record<string, { description?: string; label?: string }>;
  title?: string;
}

export interface WidgetPreset {
  category: WidgetPresetCategory;
  /**
   * Shape of the data the script prints, e.g. `weather.v1`. Presets sharing a
   * contract can swap views over the same data.
   */
  contract?: string;
  description: string;
  /** Stable kebab-case id, e.g. `weather-now`. */
  id: string;
  /** Keyed by locale, e.g. `zh-CN`. */
  locales?: Record<string, WidgetPresetLocale>;
  /** What the card shows in a gallery before the widget ever runs. */
  sample: WidgetOutput;
  /** Default board size in grid cells. */
  size?: { h: number; w: number };
  tags?: string[];
  title: string;
  /** Semver of the preset content. */
  version: string;
  widget: {
    manifest?: WidgetManifest;
    outputType: WidgetOutputType;
    runtime: WidgetRuntime;
    script: string;
    view?: WidgetView;
  };
}
