import { type LobeBuiltinTool } from '@lobechat/types';

import { builtinTools } from '@/tools';

export interface BuiltinToolState {
  builtinToolLoading: Record<string, boolean>;
  builtinTools: LobeBuiltinTool[];
  /**
   * List of uninstalled builtin tool identifiers
   * Empty array means all builtin tools are enabled
   */
  uninstalledBuiltinTools: string[];
  /**
   * Loading state for fetching uninstalled builtin tools
   */
  uninstalledBuiltinToolsLoading: boolean;
}

export const initialBuiltinToolState: BuiltinToolState = {
  builtinToolLoading: {},
  builtinTools,
  uninstalledBuiltinTools: [],
  uninstalledBuiltinToolsLoading: true,
};
