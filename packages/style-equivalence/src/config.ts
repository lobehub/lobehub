import type { PluginOption } from 'vite';

import type { CalibrationAdapter } from './calibration';
import type { RealComponent, StyleAdapter } from './extract';

export type ConditionVariant = 'reduced-motion' | 'rtl';

export interface ConditionConfig {
  themeAttribute: string;
  themes: string[];
  variants?: ConditionVariant[];
  widths: number[];
}

export interface ViteSetup {
  alias?: Array<{ find: string | RegExp; replacement: string }>;
  dedupe?: string[];
  define?: Record<string, string>;
  plugins: PluginOption[];
  tsconfigPaths?: boolean;
}

export interface ProjectConfig {
  adapters: StyleAdapter[];
  aliases: Record<string, string>;
  calibration?: CalibrationAdapter;
  conditions: ConditionConfig;
  cxFallback?: { name: string; source: string };
  hostWrapper: string;
  layoutComponents: string[];
  realComponents?: Record<string, RealComponent>;
  vite: (root: string) => Promise<ViteSetup>;
}
