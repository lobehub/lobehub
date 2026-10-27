import type { ToolDetailType } from './features/SkillDetail';

/**
 * Mobile shows the skill list and one skill's detail as separate screens. The
 * open detail lives in this search param so the phone's back gesture returns to
 * the list instead of leaving the settings page.
 */
export const MOBILE_SELECTION_PARAM = 'open';

const DETAIL_TYPES = new Set<ToolDetailType>([
  'agent-connector',
  'agent-skill',
  'builtin',
  'builtin-skill',
  'lobehub-connector',
  'mcp-connector',
  'plugin',
]);

export interface MobileSelection {
  identifier: string;
  type: ToolDetailType;
}

export const encodeMobileSelection = ({ identifier, type }: MobileSelection) =>
  `${type}:${identifier}`;

/** Undefined for a missing or malformed value, which shows the list. */
export const parseMobileSelection = (value: string | null): MobileSelection | undefined => {
  const separator = value?.indexOf(':') ?? -1;
  if (!value || separator <= 0) return undefined;

  const type = value.slice(0, separator) as ToolDetailType;
  const identifier = value.slice(separator + 1);
  if (!DETAIL_TYPES.has(type) || !identifier) return undefined;

  return { identifier, type };
};
