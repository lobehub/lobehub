import type {LobeBuiltinTool} from '@lobechat/types';

import { builtinTools } from '@/tools';

export interface BuiltinToolState {
  builtinToolLoading: Record<string, boolean>;
  builtinTools: LobeBuiltinTool[];
}

export const initialBuiltinToolState: BuiltinToolState = {
  builtinToolLoading: {},
  builtinTools,
};
