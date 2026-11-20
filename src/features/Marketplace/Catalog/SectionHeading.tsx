'use client';

import { Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronRightIcon } from 'lucide-react';
import { memo } from 'react';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

const styles = stylex.create({
  // The Codex group heading (`Popular >`): 16px semibold, inset 12px so it
  // shares a left edge with the rows' icon tiles.
  heading: {
    display: 'flex',
    alignItems: 'center',
    marginBlock: 0,
    paddingInline: '12px',
    fontSize: cssVar.fontSizeHeading5,
    fontWeight: 600,
    color: cssVar.colorText,
  },
  link: {
    display: 'inline-flex',
    gap: '4px',
    alignItems: 'center',
    borderRadius: cssVar.borderRadiusSM,
    color: { 'default': 'inherit', ':hover': cssVar.colorText },
  },
  chevron: {
    transitionDuration: '150ms',
    transitionProperty: 'transform',
    color: cssVar.colorTextSecondary,
  },
});

interface SectionHeadingProps {
  label: string;
  /** Accessible name for the link, e.g. "Developer · View all". */
  linkLabel: string;
  /** The full list behind the preview (a category or a sort of the catalog). */
  to: string;
}

/**
 * A catalog group heading: like Codex's `Popular >`, the heading itself links
 * to every item of the group; the preview under it shows the first few.
 */
const SectionHeading = memo<SectionHeadingProps>(({ label, linkLabel, to }) => (
  <h3 {...stylex.props(styles.heading)}>
    <WorkspaceLink aria-label={linkLabel} title={linkLabel} to={to} {...stylex.props(styles.link)}>
      {label}
      <Icon icon={ChevronRightIcon} size={16} {...stylex.props(styles.chevron)} />
    </WorkspaceLink>
  </h3>
));

SectionHeading.displayName = 'MarketplaceCatalogSectionHeading';

export default SectionHeading;
