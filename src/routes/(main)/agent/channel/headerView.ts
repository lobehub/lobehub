export interface ChannelHeaderView {
  /** Show the `Agent › Channels › Platform` trail; otherwise the profile tab switcher. */
  detail: boolean;
  /**
   * Platform name for the last crumb; `undefined` while the definitions are
   * loading. An unknown id (the page renders 404) falls back to the raw id.
   */
  platformName?: string;
}

/**
 * Decide the channel header layout from the route, not from the loaded platform
 * catalog. A deep link to `/channel/:platform` renders the header before the
 * definitions arrive; keying on the definition flashed the list's tab switcher
 * between the detail route skeleton and the loaded breadcrumb.
 */
export const resolveChannelHeaderView = (
  platformId: string | undefined,
  platformDef: { name: string } | undefined,
  loading: boolean,
): ChannelHeaderView => ({
  // A loaded definition still implies a detail page for callers that pass
  // only `platformDef`.
  detail: !!platformId || !!platformDef,
  platformName: platformDef?.name ?? (loading ? undefined : platformId),
});
