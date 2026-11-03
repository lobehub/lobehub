import type { PluginOption } from 'vite';

import type { StyleAdapter } from './extract';

export interface ConditionConfig {
  themeAttribute: string;
  themes: string[];
  widths: number[];
}

export interface ViteSetup {
  alias?: Array<{ find: string | RegExp; replacement: string }>;
  dedupe?: string[];
  define?: Record<string, string>;
  plugins: PluginOption[];
}

export interface ProjectConfig {
  adapters: StyleAdapter[];
  aliases: Record<string, string>;
  conditions: ConditionConfig;
  cxFallback?: { name: string; source: string };
  hostWrapper: string;
  layoutComponents: string[];
  vite: (root: string) => Promise<ViteSetup>;
}
