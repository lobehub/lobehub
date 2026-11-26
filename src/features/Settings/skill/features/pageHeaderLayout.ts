/** Where the list page header puts its search field. */
export type PageSearchPlacement = 'below-title' | 'toolbar';

/**
 * The Codex header shares the title row with a toolbar of the 240px search,
 * refresh and Add. That toolbar cannot wrap and is ~394px wide, wider than a
 * 375px or 390px phone, so a compact (mobile) header gives the search its own
 * full-width row under the title and keeps only refresh and Add beside it.
 */
export const getPageSearchPlacement = (compact?: boolean): PageSearchPlacement =>
  compact ? 'below-title' : 'toolbar';
