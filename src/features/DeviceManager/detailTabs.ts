const DETAIL_TABS = ['overview', 'files', 'agents', 'terminal'] as const;
export type DetailTab = (typeof DETAIL_TABS)[number];

/**
 * The tab `?tab=` names, if the caller may see it. The terminal hands over a
 * shell on the machine, so it exists only for a caller allowed to operate the
 * device; a link to it opens the overview for everyone else.
 */
export const resolveDetailTab = (value: string | null, canOperate: boolean): DetailTab => {
  if (!value || !(DETAIL_TABS as readonly string[]).includes(value)) return 'overview';
  if (value === 'terminal' && !canOperate) return 'overview';
  return value as DetailTab;
};
