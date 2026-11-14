'use client';

import * as stylex from '@stylexjs/stylex';
import { createContext, type ReactNode, type Ref, use } from 'react';
import { createPortal } from 'react-dom';

/** The page-actions row at the top of the settings content column, owned by `SettingsContent`. */
export const SettingsPageActionsContext = createContext<HTMLElement | null>(null);

const styles = stylex.create({
  row: {
    display: { ':empty': 'none', 'default': 'flex' },
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    // `SettingContainer` spaces its children 36px apart; pull the first section
    // up so the actions read as part of it (16px) rather than a section of their own.
    marginBlockEnd: -20,
  },
});

/**
 * The right-aligned row page actions render into. It sits inside the content
 * column rather than the navigation header, so actions line up with the page
 * body instead of the panel edge; it collapses while no page fills it.
 */
export const SettingsPageActionsRow = ({
  children,
  ref,
}: {
  children?: ReactNode;
  ref?: Ref<HTMLDivElement>;
}) => (
  <div ref={ref} {...stylex.props(styles.row)}>
    {children}
  </div>
);

/**
 * Renders page-level actions (e.g. "Create") into the page-actions row, so every
 * settings page keeps the shared navigation title while still owning its
 * actions. Outside the desktop settings frame (mobile, workspace settings) there
 * is no row and the children render nowhere; pass them through `fallback` to
 * keep them in the page body there.
 */
const SettingsPageActions = ({
  children,
  fallback = null,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) => {
  const node = use(SettingsPageActionsContext);
  if (!node) return fallback;
  return createPortal(children, node);
};

export default SettingsPageActions;
