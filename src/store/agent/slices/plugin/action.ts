import { type AgentPluginMode, getPluginMode, upsertPluginMode } from '@lobechat/types';
import { produce } from 'immer';

import { type StoreSetter } from '@/store/types';

import { agentSelectors } from '../../selectors';
import { type AgentStore } from '../../store';

/**
 * Plugin Slice Actions
 * Handles plugin toggle operations
 */

type Setter = StoreSetter<AgentStore>;
export const createPluginSlice = (set: Setter, get: () => AgentStore, _api?: unknown) =>
  new PluginSliceActionImpl(set, get, _api);

export class PluginSliceActionImpl {
  readonly #get: () => AgentStore;

  constructor(set: Setter, get: () => AgentStore, _api?: unknown) {
    void _api;
    void set;
    this.#get = get;
  }

  removePlugin = async (id: string): Promise<void> => {
    await this.#get().togglePlugin(id, false);
  };

  /**
   * Boolean pin/unpin toggle, kept for the many callers that only ever
   * add-to-agent or remove-from-agent (no disabled concept). Internally
   * upgrades to `upsertPluginMode` so the write path is unified with
   * `setPluginMode`; callers that need the third (disabled) state should use
   * `setPluginMode` directly instead.
   */
  togglePlugin = async (id: string, open?: boolean): Promise<void> => {
    const originConfig = agentSelectors.currentAgentConfig(this.#get());
    if (!originConfig) return;

    const shouldOpen =
      open !== undefined ? open : getPluginMode(originConfig.plugins, id) !== 'pinned';

    await this.setPluginMode(id, shouldOpen ? 'pinned' : 'auto');
  };

  /**
   * Sets one identifier's explicit mode (pinned / auto / disabled). Only the
   * touched entry is upgraded to object shape — every other entry, including
   * untouched legacy strings, is left exactly as-is (lazy per-item upgrade).
   */
  setPluginMode = async (id: string, mode: AgentPluginMode): Promise<void> => {
    const originConfig = agentSelectors.currentAgentConfig(this.#get());
    if (!originConfig) return;

    const config = produce(originConfig, (draft) => {
      // `LobeAgentConfig['plugins']` is still typed `string[]` — widening it is
      // deferred to the final phase of the tri-state rollout so `.includes()`
      // call sites keep getting compiler errors until manually migrated. The
      // runtime value legitimately becomes mixed-shape here (JSONB has no
      // schema enforcement), so this cast is the one deliberate boundary
      // where that mismatch is intentional.
      draft.plugins = upsertPluginMode(draft.plugins, id, mode) as unknown as string[];
    });

    await this.#get().updateAgentConfig(config);
  };
}

export type PluginSliceAction = Pick<PluginSliceActionImpl, keyof PluginSliceActionImpl>;
