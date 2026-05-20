import { GroupBotIcon } from '@lobehub/ui/icons';
import { Compass, type LucideIcon, Search, Settings } from 'lucide-react';
import type { FC } from 'react';

type IconComponent = LucideIcon | FC<{ className?: string; size?: number }>;

export interface CCSubagentTypeInfo {
  icon: IconComponent;
  label: string;
}

/**
 * Known subagent templates shipped with CC. `subagent_type` on the Agent
 * tool call is matched against this map; unknown values fall through to
 * the raw string plus a generic bot icon so user-defined subagents still
 * render sensibly.
 *
 * UI-level (icons are React components) so it lives in the CC client entry
 * rather than `@lobechat/heterogeneous-agents` — that package stays a
 * pure-data home for adapter orchestration.
 */
export const CC_SUBAGENT_TYPES: Record<string, CCSubagentTypeInfo> = {
  'Explore': { icon: Search, label: 'Explore' },
  'Plan': { icon: Compass, label: 'Plan' },
  'general-purpose': { icon: GroupBotIcon, label: 'General purpose' },
  'statusline-setup': { icon: Settings, label: 'Statusline setup' },
};

/**
 * Resolve a `subagent_type` string to `{ icon, label }`. Returns `undefined`
 * when the input is empty/whitespace so callers can distinguish "no value"
 * from "unknown value" — the latter gets a synthesized fallback.
 */
export const resolveCCSubagentType = (
  subagentType: string | undefined | null,
): CCSubagentTypeInfo | undefined => {
  const trimmed = subagentType?.trim();
  if (!trimmed) return undefined;
  return CC_SUBAGENT_TYPES[trimmed] ?? { icon: GroupBotIcon, label: trimmed };
};
