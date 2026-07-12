import { useState } from 'react';

import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/slices/settings/selectors';

export type WebBrowsingChannelKey = 'crawlerImpls' | 'searchProviders';

export interface ChannelRow {
  enabled: boolean;
  id: string;
}

/**
 * Build the initial ordered rows from the server-provided available channels
 * and the user's saved config.
 *
 * - No saved config → all channels enabled, in server default order.
 * - Saved config → enabled channels first (in the user's saved priority order,
 *   filtered to still-available ids), then the remaining available channels as
 *   disabled, in server order.
 *
 * An empty saved array — or a saved array whose ids no longer intersect the
 * available set (e.g. the configured providers were disabled/renamed on the
 * server) — is treated as "unconfigured" (all enabled). This matches the
 * server-side `resolveOrderedChannels` fallback (empty intersection → default
 * order), keeps the "at least one enabled" invariant, and avoids rendering every
 * channel as disabled while search/crawl actually runs on the default set.
 */
const buildRows = (availableIds: string[], savedOrder: string[] | undefined): ChannelRow[] => {
  if (!savedOrder?.length) return availableIds.map((id) => ({ enabled: true, id }));

  const enabledIds = savedOrder.filter((id) => availableIds.includes(id));
  if (enabledIds.length === 0) return availableIds.map((id) => ({ enabled: true, id }));

  const enabledSet = new Set(enabledIds);
  const disabledIds = availableIds.filter((id) => !enabledSet.has(id));

  return [
    ...enabledIds.map((id) => ({ enabled: true, id })),
    ...disabledIds.map((id) => ({ enabled: false, id })),
  ];
};

/**
 * Manage the local order + enabled state for a single web-browsing channel
 * list and persist changes to `settings.tool.webBrowsing`.
 *
 * Only enabled ids are persisted (as an ordered array = priority). Disabled
 * ids are simply absent, matching the `UserWebBrowsingConfig` contract.
 *
 * Local UI state is seeded ONCE from `availableIds` + `savedOrder` on mount and
 * is intentionally NOT re-synced afterwards (avoids the write-back → re-render →
 * reset loop). The parent (`ToolSetting`) MUST therefore only mount this
 * component after BOTH the available channels have been fetched AND the user
 * settings store has hydrated (`isUserStateInit`) — otherwise `savedOrder` reads
 * as `undefined` at mount and the saved priority order is lost on a hard refresh.
 */
export const useChannelRows = (channelKey: WebBrowsingChannelKey, availableIds: string[]) => {
  const savedOrder = useUserStore(
    (s) => settingsSelectors.currentSettings(s).tool?.webBrowsing?.[channelKey],
  );
  const setSettings = useUserStore((s) => s.setSettings);

  const [rows, setRows] = useState<ChannelRow[]>(() => buildRows(availableIds, savedOrder));

  const persist = (nextRows: ChannelRow[]) => {
    const enabledIds = nextRows.filter((row) => row.enabled).map((row) => row.id);
    // The merge util replaces arrays wholesale, so this stores the ordered
    // enabled ids as-is rather than index-merging with the previous value.
    return setSettings({ tool: { webBrowsing: { [channelKey]: enabledIds } } });
  };

  const reorder = (nextRows: ChannelRow[]) => {
    setRows(nextRows);
    void persist(nextRows);
  };

  const toggle = (id: string, enabled: boolean) => {
    const nextRows = rows.map((row) => (row.id === id ? { ...row, enabled } : row));
    setRows(nextRows);
    void persist(nextRows);
  };

  return { reorder, rows, toggle };
};
