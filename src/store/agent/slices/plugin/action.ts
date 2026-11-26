import {
  type AgentPluginMode,
  parsePluginEntry,
  setBuiltinPluginMode,
  upsertConnectorEnabled,
  upsertPluginMode,
} from '@lobechat/types';
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

  /** Drops an entry from `plugins` entirely (used when uninstalling or clearing deprecated items). */
  removePlugin = async (id: string): Promise<void> => {
    await this.setPluginMode(id, 'auto');
  };

  /**
   * Two-state enable/disable toggle (`auto` vs `disabled`).
   * Builtin tools and skills record `builtinOverride: true` so an explicit
   * per-agent choice overrides any legacy library-wide uninstall.
   */
  togglePlugin = async (id: string, open?: boolean): Promise<void> => {
    // Pin the Agent first: the user may switch Agents while the chunks load.
    const agentId = this.#get().activeAgentId;
    if (!agentId) return;

    // This store is on the first screen; the builtin-tools entry carries every tool manifest.
    const [{ isOnDemandBuiltinTool }, { legacyBuiltinSkillIds }] = await Promise.all([
      import('@lobechat/builtin-tools'),
      import('@lobechat/mecha/builtinSkillGate'),
    ]);

    const originConfig = agentSelectors.getAgentConfigById(agentId)(this.#get());
    if (!originConfig) return;

    const existing = originConfig.plugins?.find(
      (entry) => parsePluginEntry(entry).identifier === id,
    );
    const isEnabled = existing ? parsePluginEntry(existing).mode !== 'disabled' : false;
    const shouldOpen = open !== undefined ? open : !isEnabled;

    const config = produce(originConfig, (draft) => {
      draft.plugins = (isOnDemandBuiltinTool(id) || legacyBuiltinSkillIds.includes(id)
        ? setBuiltinPluginMode(draft.plugins, id, shouldOpen ? 'auto' : 'disabled')
        : upsertConnectorEnabled(draft.plugins, id, shouldOpen)) as unknown as string[];
    });

    await this.#get().updateAgentConfigById(agentId, config);
  };

  /**
   * Sets one identifier's explicit mode (pinned / auto / disabled). Only the
   * touched entry is upgraded to object shape — every other entry, including
   * untouched legacy strings, is left exactly as-is (lazy per-item upgrade).
   *
   * `implicitMode` is what the identifier resolves to with no entry at all:
   * `'auto'` for tools and builtin skills, `'disabled'` for a library skill
   * (`LIBRARY_SKILL_IMPLICIT_MODE`). Setting that mode drops the entry; any
   * other is written explicitly, so a library skill set to `'auto'` is kept.
   */
  setPluginMode = async (
    id: string,
    mode: AgentPluginMode,
    implicitMode: AgentPluginMode = 'auto',
  ): Promise<void> => {
    const originConfig = agentSelectors.currentAgentConfig(this.#get());
    if (!originConfig) return;

    const config = produce(originConfig, (draft) => {
      // `LobeAgentConfig['plugins']` is still typed `string[]` — widening it is
      // deferred to the final phase of the tri-state rollout so `.includes()`
      // call sites keep getting compiler errors until manually migrated. The
      // runtime value legitimately becomes mixed-shape here (JSONB has no
      // schema enforcement), so this cast is the one deliberate boundary
      // where that mismatch is intentional.
      draft.plugins = upsertPluginMode(
        draft.plugins,
        id,
        mode,
        implicitMode,
      ) as unknown as string[];
    });

    await this.#get().updateAgentConfig(config);
  };
}

export type PluginSliceAction = Pick<PluginSliceActionImpl, keyof PluginSliceActionImpl>;
