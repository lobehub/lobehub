import {
  type AgentPluginEntry,
  getLibrarySkillMode,
  LIBRARY_SKILL_IMPLICIT_MODE,
  upsertPluginMode,
} from '@lobechat/types';
import { useRef, useState } from 'react';

import { filterSkillItems, type SkillListItem } from '@/features/SkillsList';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

/** Apply only edited skills to the latest config, preserving tools and untouched modes. */
export const applyUserSkillChanges = (
  plugins: AgentPluginEntry[] | undefined,
  changes: Record<string, boolean>,
): AgentPluginEntry[] => {
  let next = plugins ?? [];
  for (const [id, enabled] of Object.entries(changes)) {
    if ((getLibrarySkillMode(next, id) !== 'disabled') === enabled) continue;
    next = upsertPluginMode(next, id, enabled ? 'pinned' : 'disabled', LIBRARY_SKILL_IMPLICIT_MODE);
  }
  return next;
};

export const useUserSkillsManagement = (
  agentId: string,
  items: SkillListItem[],
  canEdit: boolean,
) => {
  const [baseline] = useState(() => {
    const plugins = agentByIdSelectors.getAgentConfigById(agentId)(
      useAgentStore.getState(),
    )?.plugins;
    return Object.fromEntries(
      items.map(({ id }) => [id, getLibrarySkillMode(plugins, id) !== 'disabled']),
    );
  });
  const [changes, setChanges] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const savingRef = useRef(false);
  const isSelected = (id: string) => changes[id] ?? baseline[id] ?? false;
  const filteredItems = filterSkillItems(items, query);
  const installedIds = new Set(items.map(({ id }) => id));
  const pendingChanges = Object.fromEntries(
    Object.entries(changes).filter(([id]) => installedIds.has(id)),
  );

  const setSelected = (ids: string[], selected: boolean) => {
    if (!canEdit || savingRef.current) return;
    setChanges((current) => {
      const next = { ...current };
      for (const id of ids) {
        if (!installedIds.has(id)) continue;
        if (selected === Boolean(baseline[id])) delete next[id];
        else next[id] = selected;
      }
      return next;
    });
  };

  const save = async () => {
    if (!canEdit || !agentId || savingRef.current) return false;
    if (Object.keys(pendingChanges).length === 0) return true;
    const state = useAgentStore.getState();
    const config = agentByIdSelectors.getAgentConfigById(agentId)(state);
    if (!config) return false;
    savingRef.current = true;
    setSaving(true);
    setSaveFailed(false);
    try {
      await state.updateAgentConfigById(
        agentId,
        { plugins: applyUserSkillChanges(config.plugins, pendingChanges) },
        { rethrow: true, showErrorMessage: false },
      );
      return true;
    } catch {
      setSaveFailed(true);
      // Config writes are optimistic. Restore the confirmed config after failure,
      // while keeping this editor's draft intact for Retry or Cancel.
      try {
        await useAgentStore.getState().internal_refreshAgentConfig(agentId);
      } catch {
        // The inline save error stays visible even if the refresh also fails.
      }
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return {
    dirty: Object.keys(pendingChanges).length > 0,
    filteredItems,
    isSelected,
    query,
    save,
    saveFailed,
    saving,
    selectedCount: items.filter(({ id }) => isSelected(id)).length,
    setQuery,
    setSelected,
  };
};
