import { createContext, useContext } from 'react';

export interface SidebarRowMarksScope {
  /** Rows sit in a private folder, whose header already carries the lock. */
  inPrivateFolder?: boolean;
  /** Rows sit under a "Pinned" / "Pinned for team" header that names the pin. */
  pinnedByHeader?: boolean;
}

/**
 * Where a sidebar row is rendered, so it can leave a marker to its section
 * header instead of repeating it. Rows outside any provider draw every marker.
 */
export const SidebarRowMarksContext = createContext<SidebarRowMarksScope>({});

export const useSidebarRowMarksScope = () => useContext(SidebarRowMarksContext);
