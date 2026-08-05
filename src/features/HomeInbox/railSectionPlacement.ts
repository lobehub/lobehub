interface RailSectionPlacementInput {
  /** The rail is folded away, so the main column carries the sections it owns. */
  inlineRail?: boolean;
  variant: 'default' | 'main' | 'rail';
}

/**
 * Whether this column carries the sections the rail owns — running and news.
 *
 * They live in the rail while it is open; the main column takes them only once
 * it folds away, which is the difference between "collapsed" and "gone": a
 * folded rail must not take what is in flight and what happened off the page.
 */
export const ownsRailSections = ({ inlineRail, variant }: RailSectionPlacementInput): boolean =>
  variant !== 'main' || Boolean(inlineRail);
