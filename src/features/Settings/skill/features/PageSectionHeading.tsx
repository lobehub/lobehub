'use client';

import { Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronRightIcon } from 'lucide-react';
import { memo } from 'react';

const styles = stylex.create({
  // The Codex group heading (`Popular >`): 16px semibold, inset 12px so it
  // shares a left edge with the page title and the rows' icon tiles.
  heading: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    marginBlock: 0,
    paddingInline: '12px',
    fontSize: cssVar.fontSizeHeading5,
    fontWeight: 600,
    color: cssVar.colorText,
  },
  // A group longer than its preview: the whole heading expands it.
  toggle: {
    cursor: 'pointer',
    display: 'inline-flex',
    gap: '8px',
    alignItems: 'center',
    margin: 0,
    padding: 0,
    borderWidth: 0,
    borderStyle: 'none',
    borderRadius: cssVar.borderRadiusSM,
    fontFamily: 'inherit',
    fontSize: 'inherit',
    fontWeight: 'inherit',
    lineHeight: 'inherit',
    color: 'inherit',
    backgroundColor: 'transparent',
  },
  chevron: {
    transitionDuration: '150ms',
    transitionProperty: 'transform',
    color: cssVar.colorTextSecondary,
  },
  chevronExpanded: { transform: 'rotate(90deg)' },
});

interface PageSectionHeadingProps {
  /**
   * Whether the group has more rows than its preview (or is already expanded).
   * Without it the heading is plain text and carries no chevron.
   */
  expandable: boolean;
  /** Whether the group shows every row instead of its preview. */
  expanded: boolean;
  label: string;
  onToggle: () => void;
  /** Accessible name / tooltip for the toggle, e.g. "Show all (11)" or "Show less". */
  toggleLabel: string;
}

/**
 * A catalog group heading. Like Codex's `Popular >`, only a group longer than
 * its preview gets the chevron, and the heading itself is the control that
 * shows every row (the chevron turns down) or folds back to the preview.
 */
const PageSectionHeading = memo<PageSectionHeadingProps>(
  ({ expandable, expanded, label, onToggle, toggleLabel }) => (
    <h3 {...stylex.props(styles.heading)}>
      {expandable ? (
        <button
          aria-expanded={expanded}
          aria-label={`${label} · ${toggleLabel}`}
          title={toggleLabel}
          type={'button'}
          {...stylex.props(styles.toggle)}
          onClick={onToggle}
        >
          {label}
          <Icon
            icon={ChevronRightIcon}
            size={16}
            {...stylex.props(styles.chevron, expanded && styles.chevronExpanded)}
          />
        </button>
      ) : (
        label
      )}
    </h3>
  ),
);

PageSectionHeading.displayName = 'PageSectionHeading';

export default PageSectionHeading;
