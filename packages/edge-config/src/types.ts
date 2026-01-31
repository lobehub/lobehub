/* eslint-disable sort-keys-fix/sort-keys-fix, typescript-sort-keys/interface */
import type { BusinessEdgeConfigData } from '@lobechat/business-config/server';

/**
 * EdgeConfig complete configuration type
 */
export interface EdgeConfigData extends BusinessEdgeConfigData {
  /**
   * Assistant blacklist
   */
  assistant_blacklist?: string[];
  /**
   * Assistant whitelist
   */
  assistant_whitelist?: string[];

  /**
   * Feature flags configuration
   */
  feature_flags?: Record<string, boolean | string[]>;
}

export type EdgeConfigKeys = keyof EdgeConfigData;
