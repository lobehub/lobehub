/**
 * What the rail inbox is showing: `pending` while a feed that may fill it is
 * still loading, `empty` once every feed answered with no card, `filled` when
 * any card (or error) is on screen.
 */
export type RailContentState = 'empty' | 'filled' | 'pending';

interface RailContentInput {
  /** Every feed that may fill the rail has answered (with data or an error). */
  feedsSettled: boolean;
  /** A section, recommendation or usage card is on screen. */
  hasCards: boolean;
}

/** A card decides at once; otherwise the rail is empty only once its feeds answered. */
export const resolveRailContentState = ({
  feedsSettled,
  hasCards,
}: RailContentInput): RailContentState => {
  if (hasCards) return 'filled';

  return feedsSettled ? 'empty' : 'pending';
};
