'use client';

import { createContext, type ReactNode, use } from 'react';
import { createPortal } from 'react-dom';

/** The DOM node on the right of the settings navigation header, owned by `SettingsContent`. */
export const SettingsHeaderActionsContext = createContext<HTMLElement | null>(null);

/**
 * Renders page-level actions (e.g. "Create") on the right of the shared settings
 * navigation header, so every settings page keeps one title style while still
 * owning its actions. Outside the desktop settings frame (mobile, workspace
 * settings) there is no slot and the children render nowhere; pass them through
 * `fallback` to keep them in the page body there.
 */
const SettingsHeaderActions = ({
  children,
  fallback = null,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) => {
  const node = use(SettingsHeaderActionsContext);
  if (!node) return fallback;
  return createPortal(children, node);
};

export default SettingsHeaderActions;
