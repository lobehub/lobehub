import type { ComponentType } from 'react';

export interface SettingsTabSkeletonProps {
  /** The second path segment, e.g. a messenger platform or an OAuth app id. */
  sub?: string;
}

/**
 * The one loading shape of a settings tab. The route fallback, the chunk
 * fallback and the tab's own data-loading branch all render it, so the page
 * never swaps between differently shaped skeletons.
 */
export interface SettingsTabSkeleton {
  /** The tab body inside the shared header + container frame. */
  Body: ComponentType<SettingsTabSkeletonProps>;
  /**
   * The whole page, for tabs that draw their own header and container
   * (`OWN_FRAME_TABS`). Mobile still renders `Body` under the mobile header.
   */
  Page?: ComponentType<SettingsTabSkeletonProps>;
  /**
   * Placeholders for the actions the settled page portals into the page-actions
   * row at the top of the content column (see `SettingsPageActions`).
   */
  PageActions?: ComponentType<SettingsTabSkeletonProps>;
}
