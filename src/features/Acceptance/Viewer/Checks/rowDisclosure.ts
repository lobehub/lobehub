interface RowDisclosureInput {
  expanded: boolean;
  /** Set when the row opens the check on its own page instead of in place. */
  onOpenDetail?: () => void;
  onToggle: () => void;
}

/**
 * How a check row answers a tap.
 *
 * A row that navigates must never also unfold: an expand entry seeded on a
 * wide window survives a resize down to phone width, which would leave the row
 * disclosing a full evidence review under the finger that just opened the same
 * check on its own page. It is also not a disclosure widget any more, so it
 * stops claiming `aria-expanded` — announcing "collapsed" would promise an
 * expansion that never comes.
 */
export const checkRowDisclosure = ({ expanded, onOpenDetail, onToggle }: RowDisclosureInput) => ({
  activate: onOpenDetail ?? onToggle,
  ariaExpanded: onOpenDetail ? undefined : expanded,
  open: expanded && !onOpenDetail,
});
