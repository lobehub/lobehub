import {
  type AgentPluginEntry,
  type AgentPluginMode,
  getPluginMode,
  type SidebarAgentItem,
} from '@lobechat/types';
import { toast } from '@lobehub/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';

import { agentService } from '@/services/agent';
import { useAgentStore } from '@/store/agent';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors, userProfileSelectors } from '@/store/user/selectors';

export interface SkillAgent {
  agent: SidebarAgentItem;
  /** On (`pinned`) or switched off (`disabled`); an assistant without the skill is not listed. */
  enabled: boolean;
}

type ExplicitMode = Exclude<AgentPluginMode, 'auto'>;

const isAbort = (error: unknown) =>
  error instanceof Error && (error.name === 'AbortError' || error.message.includes('aborted'));

/** Applies a mode to a local agentId → mode map; `auto` drops the entry. */
const withMode = (
  modes: Record<string, ExplicitMode>,
  agentIds: string[],
  mode: AgentPluginMode,
): Record<string, ExplicitMode> => {
  const next = { ...modes };
  for (const id of agentIds) {
    if (mode === 'auto') delete next[id];
    else next[id] = mode;
  }
  return next;
};

/**
 * Last answer per skill (agentId → mode), shared by the skill page and the list
 * rows, so coming back to either paints at once while it refreshes.
 */
const modesCache = new Map<string, Record<string, ExplicitMode>>();

const toModes = (rows: { agentId: string; mode: ExplicitMode }[]) =>
  Object.fromEntries(rows.map(({ agentId, mode }) => [agentId, mode]));

/** My own LobeHub assistants; external runtimes and other people's agents are left out. */
export const useMyAgentCandidates = (enabled: boolean) => {
  const isLogin = useUserStore(authSelectors.isLogin);
  const userId = useUserStore(userProfileSelectors.userId);
  const useFetchAgentList = useHomeStore((s) => s.useFetchAgentList);
  useFetchAgentList(enabled && isLogin);

  return useHomeStore(
    useShallow((s) =>
      homeAgentListSelectors
        .allAgents(s)
        .filter(
          (item) =>
            item.type === 'agent' &&
            !item.heterogeneousType &&
            (!item.userId || item.userId === userId),
        ),
    ),
  );
};

/**
 * The assistants an installed skill was added to, for its row in the list:
 * the cached answer first, refreshed once on mount. `null` until there is one.
 */
export const useSkillAgentStatus = (identifier: string, enabled: boolean) => {
  const isLogin = useUserStore(authSelectors.isLogin);
  const candidates = useMyAgentCandidates(enabled);
  const [modes, setModes] = useState(() => modesCache.get(identifier));

  useEffect(() => {
    if (!enabled || !isLogin) return;
    let cancelled = false;
    agentService
      .getPluginAgentModes(identifier)
      .then((rows) => {
        const next = toModes(rows);
        modesCache.set(identifier, next);
        if (!cancelled) setModes(next);
      })
      .catch((error) => {
        if (!isAbort(error)) console.warn("[Market] Failed to load a skill's assistants", error);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, identifier, isLogin]);

  return useMemo<SkillAgent[] | null>(
    () =>
      modes
        ? candidates
            .filter((agent) => modes[agent.id])
            .map((agent) => ({ agent, enabled: modes[agent.id] === 'pinned' }))
        : null,
    [candidates, modes],
  );
};

/**
 * My assistants and a market skill: which of them carry it (on or switched off),
 * which could take it, and the writes that add, switch and remove it.
 *
 * A skill sits in an agent's `plugins` list: `pinned` is on, `disabled` is
 * off, and removing it drops the entry. The server answers which agents carry
 * it in one query and applies every write atomically on its side, so no agent's
 * full config is loaded here. Only my own LobeHub assistants count; external
 * runtimes (Claude Code, Codex, …) do not run market skills.
 */
export const useSkillAgents = (identifier: string, enabled: boolean) => {
  const { t } = useTranslation('setting');
  const isLogin = useUserStore(authSelectors.isLogin);
  const candidates = useMyAgentCandidates(enabled);

  const [modes, setModes] = useState<Record<string, ExplicitMode>>(
    () => modesCache.get(identifier) ?? {},
  );
  const [loading, setLoading] = useState(false);
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  // A reply for an earlier skill or sign-in is dropped.
  const generation = useRef(0);

  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    try {
      const rows = await agentService.getPluginAgentModes(identifier);
      if (current !== generation.current) return;
      answered.current = true;
      setModes(toModes(rows));
    } catch (error) {
      if (current === generation.current && !isAbort(error))
        console.warn('[Market] Failed to load the assistants carrying a skill', error);
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [identifier]);

  // Writes reach the shared cache too, so the list rows show them.
  // Set by the effect below once the cache or the server has answered for this skill.
  const answered = useRef(false);
  useEffect(() => {
    if (answered.current) modesCache.set(identifier, modes);
  }, [identifier, modes]);

  useEffect(() => {
    answered.current = modesCache.has(identifier);
    setModes(modesCache.get(identifier) ?? {});
    if (!enabled || !isLogin) {
      generation.current++;
      setLoading(false);
      return;
    }
    void load();
  }, [enabled, isLogin, load]);

  const { added, available } = useMemo(() => {
    const added: SkillAgent[] = [];
    const available: SidebarAgentItem[] = [];
    for (const agent of candidates) {
      const mode = modes[agent.id];
      if (mode) added.push({ agent, enabled: mode === 'pinned' });
      else available.push(agent);
    }
    return { added, available };
  }, [candidates, modes]);

  /**
   * Writes a mode on the server, then settles the list and any loaded agent
   * config from the `plugins` it returns. Without `agentIds`, `auto` removes the
   * skill from every agent carrying it; `pendingIds` names who is shown busy.
   */
  const setMode = useCallback(
    async (mode: AgentPluginMode, agentIds: string[] | undefined, busyIds: string[]) => {
      setPendingIds((ids) => [...ids, ...busyIds]);
      // Optimistic, so the switch and the list answer at once.
      setModes((current) => withMode(current, agentIds ?? busyIds, mode));
      try {
        const rows = await agentService.setPluginMode({ agentIds, identifier, mode });
        const { agentMap, internal_dispatchAgentMap } = useAgentStore.getState();
        setModes((current) => {
          const next = { ...current };
          for (const { id, plugins } of rows) {
            const written = getPluginMode(plugins as AgentPluginEntry[], identifier);
            if (written === 'auto') delete next[id];
            else next[id] = written;
            // Chat input and settings read `plugins` from the loaded config.
            if (agentMap[id]) internal_dispatchAgentMap(id, { plugins: plugins as string[] });
          }
          return next;
        });
        return true;
      } catch (error) {
        // Nothing was written: read back what the server holds.
        void load();
        if (!isAbort(error)) {
          console.error('[Market] Failed to update the skill on assistants', error);
          toast.error(t('market.skills.agents.failed'));
        }
        return false;
      } finally {
        setPendingIds((ids) => ids.filter((id) => !busyIds.includes(id)));
      }
    },
    [identifier, load, t],
  );

  const add = useCallback((agentId: string) => setMode('pinned', [agentId], [agentId]), [setMode]);
  const toggle = useCallback(
    (agentId: string, on: boolean) => setMode(on ? 'pinned' : 'disabled', [agentId], [agentId]),
    [setMode],
  );
  const remove = useCallback((agentId: string) => setMode('auto', [agentId], [agentId]), [setMode]);
  const removeAll = useCallback(
    () =>
      setMode(
        'auto',
        undefined,
        added.map(({ agent }) => agent.id),
      ),
    [added, setMode],
  );

  return {
    add,
    added,
    available,
    loading,
    pendingIds,
    remove,
    removeAll,
    toggle,
  };
};
