import { type InterfaceDensity } from '@lobechat/types';

export const STEP_TRIGGER_STYLES = {
  compact: { trigger: { fontSize: 12, paddingBlock: 1, paddingInline: 4 } },
  loose: { trigger: { paddingBlock: 4, paddingInline: 4 } },
} as const satisfies Record<InterfaceDensity, { trigger: Record<string, number> }>;
