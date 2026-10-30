import { isDesktop, randomAgentName } from '@lobechat/const';
import { type AgentContextDocument } from '@lobechat/context-engine';
import { getHeterogeneousTypeLabel } from '@lobechat/heterogeneous-agents';
import {
  applyWorkingDirByDevicePatch,
  isChatGroupSessionId,
  type LobeAgentAgencyConfig,
} from '@lobechat/types';
import { toast } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { t } from 'i18next';
import { produce } from 'immer';
import type { PartialDeep } from 'type-fest';

import { getActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { MESSAGE_CANCEL_FLAT } from '@/const/message';
import { analyticsClient } from '@/libs/analytics/client';
import {
  cacheScope,
  createReplicaSlice,
  recordLens,
  type ReplicaLens,
  type ReplicaSyncResult,
  revalidateReplica,
} from '@/libs/replica';
import { getCacheScope } from '@/libs/swr/useCacheScope';
import type { AvailableAgentItem, CreateAgentParams, CreateAgentResult } from '@/services/agent';
import { agentService, AVAILABLE_AGENTS_CONTEXT_QUERY_LIMIT } from '@/services/agent';
import { resolveAgentDocumentsContext } from '@/services/agentDocument';
import { aiAgentService } from '@/services/aiAgent';
import { refreshAgentDeviceBindings } from '@/store/device/agentDeviceBinding';
import { useGlobalStore } from '@/store/global';
import { globalGeneralSelectors } from '@/store/global/selectors';
// Projection module only (no store import), so this does not cycle through the home store.
import { agentListResource } from '@/store/home/slices/agentList/projection';
import type { StoreSetter } from '@/store/types';
import { getUserStoreState } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';
import type {
  AgentItem,
  LobeAgentChatConfig,
  LobeAgentConfig,
  RuntimeEnvConfig,
} from '@/types/agent';
import { merge } from '@/utils/merge';

import type { AgentStore } from '../../store';
import { heteroAgentDefaultName } from '../../utils/heteroAgentDefaultName';
import { setLocalAgentWorkingDirectory } from '../../utils/localAgentWorkingDirectoryStorage';
import { getSidebarAgentNames } from '../../utils/sidebarAgentNames';
import type { AgentSliceState, LoadingState, SaveStatus } from './initialState';
import {
  agentConfigResource,
  agentSlugIdResource,
  AVAILABLE_AGENTS_KEY,
  availableAgentsResource,
  HETERO_SERVER_DEFAULT_CAPABILITY_KEY,
  heteroServerDefaultCapabilityResource,
  type ServerDefaultHeterogeneousCapability,
} from './projection';

const AGENT_META_KEYS = [
  'avatar',
  'backgroundColor',
  'description',
  'marketIdentifier',
  'metadata',
  'name',
  'profile',
  'societyId',
  'tags',
  'title',
] as const satisfies readonly (keyof AgentItem)[];
const AGENT_META_FIELDS: ReadonlySet<string> = new Set(AGENT_META_KEYS);

export type AgentMetaUpdate = Partial<Pick<AgentItem, (typeof AGENT_META_KEYS)[number]>>;
interface AgentConfigUpdateOptions {
  /** Devices whose directory selection was explicitly edited, never cached sibling entries. */
  replaceWorkingDirDeviceIds?: string[];
  /** Propagate the persistence failure so a scoped editor can render failed + Retry. */
  rethrow?: boolean;
  /** Keep generic error messaging for ordinary config controls. @default true */
  showErrorMessage?: boolean;
}

interface AgentMetaUpdateOptions {
  /** Propagate persistence failure to an optimistic projection so it can roll back. */
  rethrow?: boolean;
}

/**
 * Deep-merge a partial config into the current one. `profile` is replaced as a
 * whole and explicitly edited working directory selections are replaced atomically.
 * Returns `current` itself when nothing changed, so readers keep their reference.
 */
export const mergeAgentConfig = (
  current: PartialDeep<AgentItem> | undefined,
  config: PartialDeep<LobeAgentConfig>,
  options?: { replaceWorkingDirDeviceIds?: string[]; workingDirByDeviceSnapshot?: boolean },
): PartialDeep<AgentItem> => {
  const { value } = produce({ value: current ?? {} }, (draft) => {
    draft.value = merge(draft.value, config);
    // The character sheet is authored as one document — `AgentModel`
    // replaces it rather than merging — so mirror that here, or a trait the
    // user just cleared reappears until the next full fetch.
    if (Object.hasOwn(config, 'profile')) draft.value.profile = config.profile;
    const agencyConfig = draft.value.agencyConfig;
    if (agencyConfig && options?.workingDirByDeviceSnapshot) {
      // Complete server snapshots also remove device entries omitted by the server.
      agencyConfig.workingDirByDevice = config.agencyConfig?.workingDirByDevice;
    } else {
      applyWorkingDirByDevicePatch(
        agencyConfig,
        config.agencyConfig,
        options?.replaceWorkingDirDeviceIds,
      );
    }
  });
  return current && isEqual(current, value) ? current : value;
};

/** `useFetchAgentConfig` result: replica sync flags plus the SWR-era aliases. */
export interface AgentConfigSyncResult extends ReplicaSyncResult {
  /** A request is in flight and there is nothing in `agentMap` to show yet. */
  isLoading: boolean;
  /** Alias of `revalidate`. */
  mutate: () => Promise<unknown>;
}

const EMPTY_PARAMS = {} as Record<string, never>;

const isSlugConfirmed = (state: AgentStore, slug: string) =>
  !!state.agentSlugIdMap[slug] && state.agentSlugIdReplica.entries[slug]?.source === 'server';

/**
 * Several surfaces read the same one-entry replica (every open conversation, the
 * profile editor and the model bar): one request answers all of them, while a
 * write, a focus or a manual retry still refetches.
 */
const SHARED_READ_DEDUPING_INTERVAL = 10_000;

/** A store field that holds the whole value of a single-entry replica. */
const singleValueLens = <T>(
  field: keyof AgentStore & string,
  key: string,
): ReplicaLens<AgentStore, T> => ({
  clear: () => ({ [field]: undefined }) as Partial<AgentStore>,
  get: (state, entryKey) => (entryKey === key ? (state[field] as T | undefined) : undefined),
  keys: (state) => (state[field] === undefined ? [] : [key]),
  set: (_state, _key, data) => ({ [field]: data }) as Partial<AgentStore>,
});

/**
 * Agent Slice Actions
 * Handles agent CRUD operations (config/meta updates)
 */

type Setter = StoreSetter<AgentStore>;
export const createAgentSlice = (set: Setter, get: () => AgentStore, _api?: unknown) =>
  new AgentSliceActionImpl(set, get, _api);

export class AgentSliceActionImpl {
  readonly #get: () => AgentStore;
  readonly #set: Setter;
  readonly #pendingAgentDocuments = new Map<string, Promise<AgentContextDocument[] | undefined>>();
  readonly #updateAgentConfigControllers = new Map<string, AbortController>();
  readonly #updateAgentMetaControllers = new Map<string, AbortController>();
  readonly #config;
  readonly #slugId;
  readonly #available;
  readonly #heteroCapability;
  /** The refresh the chat context is waiting on, shared by concurrent sends of one scope. */
  #availableAgentsRefresh?: { promise: Promise<AvailableAgentItem[]>; scope: string };
  /** Bumped by every invalidation, so a read started before it cannot confirm the list. */
  #availableAgentsGeneration = 0;
  /**
   * Cache scopes whose list changed and is not confirmed yet, with the
   * generation of their latest change. Per scope like the replica data: a fresh
   * read in one identity never vouches for another identity's persisted copy.
   */
  readonly #staleAvailableAgentScopes = new Map<string, number>();

  constructor(set: Setter, get: () => AgentStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
    this.#config = createReplicaSlice(agentConfigResource, {
      actionPrefix: 'agentConfig',
      fetcher: async ({ agentId }) =>
        (await agentService.getAgentConfigById(agentId)) as LobeAgentConfig | null,
      get,
      // A successful fetch that resolves to null means the agent doesn't
      // exist or the caller lost access (e.g. a workspace agent switched back
      // to private) — a settled state, not "still loading". Every path that
      // fetches the config (the sync hooks and `prefetchAgentConfig`) settles
      // it the same way.
      effects: {
        onApplied: (_data, { agentId }) => this.#clearAgentNotFound(agentId),
        onMissing: ({ agentId }) => this.#markAgentNotFound(agentId),
      },
      // `null` drops the cached config (and its persisted row): surfaces
      // reading `agentMap` (title/avatar in the sidebar or header) must not
      // keep showing an agent the viewer lost access to next to the 404.
      isMissing: (incoming) => !incoming,
      // The endpoint returns a complete, authoritative profile: replace the
      // entry instead of patching it, so fields cleared on the server (e.g.
      // `editorData: null`) don't survive from an older local copy. An
      // unchanged profile keeps its reference.
      merge: (incoming, confirmed) =>
        !incoming || isEqual(incoming, confirmed) ? undefined : incoming,
      set,
      stateKey: 'agentConfigReplica',
      view: recordLens<AgentStore, PartialDeep<AgentItem>>('agentMap'),
    });
    this.#slugId = createReplicaSlice(agentSlugIdResource, {
      actionPrefix: 'agentSlugId',
      fetcher: ({ slug }) => agentService.resolveAgentIdBySlug(slug),
      get,
      // No visible agent owns the slug (anymore): drop the entry and its
      // persisted row, so the route stops painting the agent it used to name.
      isMissing: (agentId) => !agentId,
      merge: (incoming, confirmed) => (!incoming || incoming === confirmed ? undefined : incoming),
      set,
      stateKey: 'agentSlugIdReplica',
      view: recordLens<AgentStore, string>('agentSlugIdMap'),
    });
    this.#available = createReplicaSlice(availableAgentsResource, {
      actionPrefix: 'availableAgents',
      fetcher: () => agentService.queryAgents({ limit: AVAILABLE_AGENTS_CONTEXT_QUERY_LIMIT }),
      get,
      merge: (incoming, confirmed) => (isEqual(incoming, confirmed) ? undefined : incoming),
      set,
      stateKey: 'availableAgentsReplica',
      view: singleValueLens<AvailableAgentItem[]>('availableAgents', AVAILABLE_AGENTS_KEY),
    });
    this.#heteroCapability = createReplicaSlice(heteroServerDefaultCapabilityResource, {
      actionPrefix: 'heteroServerDefaultCapability',
      fetcher: () => aiAgentService.getServerDefaultHeterogeneousCapability(),
      get,
      merge: (incoming, confirmed) => (isEqual(incoming, confirmed) ? undefined : incoming),
      set,
      stateKey: 'heteroServerDefaultCapabilityReplica',
      view: singleValueLens<ServerDefaultHeterogeneousCapability>(
        'heteroServerDefaultCapability',
        HETERO_SERVER_DEFAULT_CAPABILITY_KEY,
      ),
    });
  }

  /** Confirmed, persisted value of an agent's config. */
  #replaceConfirmedAgentConfig = (
    agentId: string,
    scope: string,
    data: PartialDeep<AgentItem>,
  ): void => {
    this.#config.replace({ agentId }, data as LobeAgentConfig, scope);
  };

  #toAgentConfigSyncResult = (sync: ReplicaSyncResult, agentId: string): AgentConfigSyncResult => ({
    ...sync,
    isLoading: sync.isValidating && !this.#get().agentMap[agentId],
    mutate: sync.revalidate,
  });

  #createAgentScopedAbortController = (
    controllers: Map<string, AbortController>,
    agentId: string,
  ): AbortController => {
    controllers.get(agentId)?.abort(MESSAGE_CANCEL_FLAT);

    const controller = new AbortController();
    controllers.set(agentId, controller);
    return controller;
  };

  #syncAgentDocuments = (agentId: string, documents: AgentContextDocument[]) => {
    this.#set(
      (state) => ({
        agentDocumentsMap: {
          ...state.agentDocumentsMap,
          [agentId]: documents,
        },
      }),
      false,
      'syncAgentDocuments',
    );
  };

  appendStreamingSystemRole = (agentId: string, generation: number, chunk: string): void => {
    const {
      streamingSystemRole,
      streamingSystemRoleAgentId,
      streamingSystemRoleGeneration,
      streamingSystemRoleInProgress,
    } = this.#get();
    if (
      !streamingSystemRoleInProgress ||
      streamingSystemRoleAgentId !== agentId ||
      streamingSystemRoleGeneration !== generation
    )
      return;

    const currentContent = streamingSystemRole || '';
    this.#set({ streamingSystemRole: currentContent + chunk }, false, 'appendStreamingSystemRole');
  };

  createAgent = async (params: CreateAgentParams): Promise<CreateAgentResult> => {
    // Seed a default name so a new agent has an identity before the Agent
    // Builder conversation produces one; the builder may replace it later. It is
    // drawn here, not in the create endpoint, because the language (`auto` follows
    // the browser) resolves on the client. A caller's own name (market) is kept.
    //
    // A heterogeneous agent never draws a random personal name. In personal or
    // workspace-private scope its name is the product title; a shared workspace
    // agent adds the creator so members can distinguish identical tools.
    const heteroProvider = params.config?.agencyConfig?.heterogeneousProvider;
    const locale = globalGeneralSelectors.currentLanguage(useGlobalStore.getState());
    const config = {
      ...params.config,
      name:
        params.config?.name ||
        (heteroProvider
          ? heteroAgentDefaultName({
              productTitle: params.config?.title || getHeterogeneousTypeLabel(heteroProvider.type),
              visibility: params.visibility,
              workspaceId: getActiveWorkspaceId(),
            })
          : randomAgentName(locale, await getSidebarAgentNames())),
    };

    const result = await agentService.createAgent({ ...params, config });
    this.#get().invalidateAvailableAgents();

    const userId = userProfileSelectors.userId(getUserStoreState());

    void analyticsClient.track({
      name: 'new_agent_created',
      properties: {
        agent_id: result.agentId,
        assistant_name: params.config?.title || 'Untitled Agent',
        assistant_tags: params.config?.tags || [],
        user_id: userId || 'anonymous',
      },
    });

    return result;
  };

  finishStreamingSystemRole = async (agentId: string, generation: number): Promise<void> => {
    const { streamingSystemRoleAgentId, streamingSystemRoleGeneration } = this.#get();
    if (streamingSystemRoleAgentId !== agentId || streamingSystemRoleGeneration !== generation)
      return;

    // Persistence is handled by the invocation-scoped AgentManagerRuntime.
    // This singleton state only owns the visible typewriter animation, so a
    // superseded invocation must never clear the newer owner's buffer.
    this.#set(
      {
        streamingSystemRole: undefined,
        streamingSystemRoleAgentId: undefined,
        streamingSystemRoleInProgress: false,
      },
      false,
      'finishStreamingSystemRole',
    );
  };

  setActiveAgentId = (agentId?: string): void => {
    this.#set(
      (state) => (state.activeAgentId === agentId ? state : { activeAgentId: agentId }),
      false,
      'setActiveAgentId',
    );
  };

  setAgentPinned = (value: boolean | ((prev: boolean) => boolean)): void => {
    this.#set(
      (state) => ({
        isAgentPinned: typeof value === 'function' ? value(state.isAgentPinned) : value,
      }),
      false,
      'setAgentPinned',
    );
  };

  startStreamingSystemRole = (agentId: string): number => {
    const generation = (this.#get().streamingSystemRoleGeneration ?? 0) + 1;
    this.#set(
      {
        streamingSystemRole: '',
        streamingSystemRoleAgentId: agentId,
        streamingSystemRoleGeneration: generation,
        streamingSystemRoleInProgress: true,
      },
      false,
      'startStreamingSystemRole',
    );
    return generation;
  };

  toggleAgentPinned = (): void => {
    this.#set((state) => ({ isAgentPinned: !state.isAgentPinned }), false, 'toggleAgentPinned');
  };

  transferAgent = async (
    agentId: string,
    targetWorkspaceId: string | null,
    targetVisibility?: 'private' | 'public',
  ): Promise<{ agentId: string; slug: string | null; transferJobId: string | null }> => {
    return agentService.transferAgent(agentId, targetWorkspaceId, targetVisibility);
  };

  toggleAgentPlugin = async (pluginId: string, state?: boolean): Promise<void> => {
    const { activeAgentId, agentMap, updateAgentConfig } = this.#get();
    if (!activeAgentId) return;

    const currentPlugins = (agentMap[activeAgentId]?.plugins as string[]) || [];
    const hasPlugin = currentPlugins.includes(pluginId);

    // Determine new state
    const shouldEnable = state !== undefined ? state : !hasPlugin;

    let newPlugins: string[];
    if (shouldEnable && !hasPlugin) {
      newPlugins = [...currentPlugins, pluginId];
    } else if (!shouldEnable && hasPlugin) {
      newPlugins = currentPlugins.filter((id) => id !== pluginId);
    } else {
      // No change needed
      return;
    }

    await updateAgentConfig({ plugins: newPlugins });
  };

  updateAgentChatConfig = async (
    config: Partial<LobeAgentChatConfig>,
    options?: AgentConfigUpdateOptions,
  ): Promise<void> => {
    const { activeAgentId } = this.#get();

    if (!activeAgentId) return;

    await this.#get().updateAgentConfig({ chatConfig: config }, options);
  };

  updateAgentChatConfigById = async (
    agentId: string,
    config: Partial<LobeAgentChatConfig>,
    options?: AgentConfigUpdateOptions,
  ): Promise<void> => {
    if (!agentId) return;

    await this.#get().updateAgentConfigById(agentId, { chatConfig: config }, options);
  };

  updateAgentConfig = async (
    config: PartialDeep<LobeAgentConfig>,
    options?: AgentConfigUpdateOptions,
  ): Promise<void> => {
    const { activeAgentId } = this.#get();

    if (!activeAgentId) return;

    await this.#get().updateAgentConfigById(activeAgentId, config, options);
  };

  updateAgentConfigById = async (
    agentId: string,
    config: PartialDeep<LobeAgentConfig>,
    options?: AgentConfigUpdateOptions,
  ): Promise<void> => {
    if (!agentId) return;

    const controller = this.#createAgentScopedAbortController(
      this.#updateAgentConfigControllers,
      agentId,
    );

    try {
      await this.#get().optimisticUpdateAgentConfig(agentId, config, controller.signal, options);
      // An execution-target or device change moves where the agent routes for
      // the caller, which the sidebar presence dots cache per agent.
      if (config.agencyConfig) void refreshAgentDeviceBindings();
    } finally {
      if (this.#updateAgentConfigControllers.get(agentId) === controller) {
        this.#updateAgentConfigControllers.delete(agentId);
      }
    }
  };

  updateAgentRuntimeEnvConfigById = async (
    agentId: string,
    config: Partial<RuntimeEnvConfig>,
  ): Promise<void> => {
    if (!agentId) return;

    if (isDesktop && 'workingDirectory' in config) {
      setLocalAgentWorkingDirectory(agentId, config.workingDirectory);
      const nextMap = { ...this.#get().localAgentWorkingDirectoryMap };
      if (config.workingDirectory) {
        nextMap[agentId] = config.workingDirectory;
      } else {
        delete nextMap[agentId];
      }
      this.#set({ localAgentWorkingDirectoryMap: nextMap }, false, 'updateAgentWorkingDirectory');
    }

    const restConfig = { ...config };
    delete restConfig.workingDirectory;
    if (Object.keys(restConfig).length > 0) {
      await this.#get().updateAgentChatConfigById(agentId, { runtimeEnv: restConfig });
    }
  };

  updateAgentMeta = async (meta: AgentMetaUpdate): Promise<void> => {
    const { activeAgentId } = this.#get();

    if (!activeAgentId) return;

    await this.#get().updateAgentMetaById(activeAgentId, meta);
  };

  updateAgentMetaById = async (
    agentId: string,
    meta: AgentMetaUpdate,
    options?: AgentMetaUpdateOptions,
  ): Promise<void> => {
    if (!agentId) return;

    const controller = this.#createAgentScopedAbortController(
      this.#updateAgentMetaControllers,
      agentId,
    );

    try {
      await this.#get().optimisticUpdateAgentMeta(agentId, meta, controller.signal, options);
    } finally {
      if (this.#updateAgentMetaControllers.get(agentId) === controller) {
        this.#updateAgentMetaControllers.delete(agentId);
      }
    }
  };

  updateLoadingState = (key: keyof LoadingState, value: boolean): void => {
    this.#set(
      { loadingState: { ...this.#get().loadingState, [key]: value } },
      false,
      'updateLoadingState',
    );
  };

  updateSaveStatus = (status: SaveStatus): void => {
    this.#set(
      {
        lastUpdatedTime: status === 'saved' ? new Date() : this.#get().lastUpdatedTime,
        saveStatus: status,
      },
      false,
      'updateSaveStatus',
    );
  };

  useFetchAgentConfig = (isLogin: boolean | undefined, agentId: string): AgentConfigSyncResult => {
    const sync = this.#config.useSync(agentId ? { agentId } : null, {
      enabled: isLogin === true && !isChatGroupSessionId(agentId),
      onError: (error: any) => {
        this.#set(
          (state) => ({
            agentConfigErrorMap: {
              ...state.agentConfigErrorMap,
              [agentId]: error?.message || String(error),
            },
          }),
          false,
          'fetchAgentConfig/error',
        );
      },
      onSuccess: (data) => {
        // Not found is settled by the resource effects.
        if (!data) return;
        // Only adopt the fetched agent as the active one when nothing is
        // active yet. The active agent is owned by the route-level sync
        // (AgentIdSync on desktop/mobile, the popup pages' own setState).
        // A background or secondary config fetch — e.g. the inbox config
        // requested by the home input, a side-panel copilot, or another
        // open tab — must NOT hijack `activeAgentId` away from the routed
        // agent, which would otherwise flash the conversation header/welcome
        // back to the inbox ("Lobe AI") agent. A response of a previous scope
        // never lands in `agentMap`, so it adopts nothing either.
        if (!this.#get().activeAgentId && this.#get().agentMap[agentId]) {
          this.#set({ activeAgentId: data.id }, false, 'fetchAgentConfig');
        }
        this.#clearAgentConfigError(agentId);
      },
    });

    return this.#toAgentConfigSyncResult(sync, agentId);
  };

  /**
   * Fetch orchestration only; read the value through
   * `agentSelectors.heteroServerDefaultCapability`.
   */
  useFetchServerDefaultHeterogeneousCapability = (enabled: boolean): ReplicaSyncResult =>
    this.#heteroCapability.useSync(enabled ? EMPTY_PARAMS : null, {
      dedupingInterval: SHARED_READ_DEDUPING_INTERVAL,
    });

  /**
   * Resolve a user-chosen `/agent/<slug>` to its agent id. Fetch orchestration
   * only: read the id through `agentSelectors.getAgentIdBySlug` (the persisted
   * copy paints first) and wait for `agentSelectors.isAgentSlugConfirmed`
   * before redirecting to it — a slug can move to another agent between sessions.
   */
  useResolveAgentSlug = (slug: string | null | undefined): ReplicaSyncResult =>
    this.#slugId.useSync(slug ? { slug } : null, { revalidateOnFocus: false });

  /**
   * Seed a slug's persisted `slug → id` from the route loader, before the
   * route commits, so the first frame already knows which agent it shows.
   */
  preHydrateAgentSlug = async (slug: string): Promise<string | undefined> => {
    const scope = cacheScope.get();
    this.#slugId.ensureScope(scope);
    await this.#slugId.hydrate({ slug }, scope);

    return this.#get().agentSlugIdMap[slug];
  };

  /**
   * An agent's slug was renamed: the old slug no longer names it and the new
   * one does. Confirmed by the rename response, so no lookup is needed.
   */
  internal_confirmAgentSlug = (
    agentId: string,
    slug: string,
    {
      previousSlug,
      scope = cacheScope.get(),
    }: {
      /** The slug the agent had before the rename; its persisted row may not be loaded. */
      previousSlug?: string;
      /** The scope the rename was sent from: a response landing after a switch stays there. */
      scope?: string;
    } = {},
  ): void => {
    const staleSlugs = new Set<string>(previousSlug ? [previousSlug] : []);
    if (scope === cacheScope.get()) {
      for (const [cachedSlug, cachedAgentId] of Object.entries(this.#get().agentSlugIdMap)) {
        if (cachedAgentId === agentId) staleSlugs.add(cachedSlug);
      }
    }
    staleSlugs.delete(slug);
    // `remove` also drops the persisted row of a slug that is not loaded.
    for (const staleSlug of staleSlugs) void this.#slugId.remove(staleSlug, scope);
    // Dropped by the engine when `scope` is no longer the active one.
    this.#slugId.replace({ slug }, agentId, scope);
  };

  /**
   * The server's answer for a slug, joining the route's lookup when it is in
   * flight. Resolves `undefined` when no visible agent owns the slug.
   */
  confirmAgentSlugTarget = async (slug: string): Promise<string | undefined> => {
    if (isSlugConfirmed(this.#get(), slug)) return this.#get().agentSlugIdMap[slug];
    const { data } = await this.#slugId.fetch({ slug });
    return data ?? undefined;
  };

  /**
   * Re-trigger the agent config fetch after a failure. Clears the recorded
   * error first so consumers fall back to the loading skeleton, then
   * revalidates this agent's sync in the active scope.
   */
  retryAgentConfigFetch = async (agentId?: string): Promise<void> => {
    const id = agentId ?? this.#get().activeAgentId;
    if (!id) return;

    this.#clearAgentConfigError(id);

    await this.#config.revalidate(id);
  };

  /**
   * Warm an agent's config before navigation (sidebar hover). Skips agents
   * already in `agentMap`; the page's own sync revalidates them on mount.
   */
  prefetchAgentConfig = async (agentId: string): Promise<void> => {
    if (!agentId || this.#get().agentMap[agentId]) return;
    // Joins the page's own sync when it is already in flight; the replica
    // applies the scope / removal / clear guards and the not-found effects.
    await this.#config.fetch({ agentId });
  };

  #markAgentNotFound = (agentId: string) => {
    const { agentNotFoundMap, agentMap } = this.#get();
    if (agentNotFoundMap[agentId] && !agentMap[agentId]) return;

    this.#set(
      (state) => ({ agentNotFoundMap: { ...state.agentNotFoundMap, [agentId]: true } }),
      false,
      'markAgentNotFound',
    );
    // Also forget the head query of the dropped config (the `null` response
    // already removed it and its persisted row): a request in flight from
    // before must not repaint the agent next to the 404 content area.
    this.#config.remove(agentId);
  };

  #clearAgentNotFound = (agentId: string) => {
    if (!this.#get().agentNotFoundMap[agentId]) return;

    this.#set(
      (state) => {
        const next = { ...state.agentNotFoundMap };
        delete next[agentId];
        return { agentNotFoundMap: next };
      },
      false,
      'clearAgentNotFound',
    );
  };

  #clearAgentConfigError = (agentId: string) => {
    if (!this.#get().agentConfigErrorMap[agentId]) return;

    this.#set(
      (state) => {
        const next = { ...state.agentConfigErrorMap };
        delete next[agentId];
        return { agentConfigErrorMap: next };
      },
      false,
      'clearAgentConfigError',
    );
  };

  /** Like `useFetchAgentConfig`, but never touches `activeAgentId` or the error map. */
  useHydrateAgentConfig = (
    isLogin: boolean | undefined,
    agentId: string,
  ): AgentConfigSyncResult => {
    // The not-found state is settled by the resource effects.
    const sync = this.#config.useSync(agentId ? { agentId } : null, {
      enabled: isLogin === true && !isChatGroupSessionId(agentId),
    });

    return this.#toAgentConfigSyncResult(sync, agentId);
  };

  /** Fetch orchestration only; read the list from `availableAgents`. */
  useFetchAvailableAgents = (enabled: boolean): ReplicaSyncResult =>
    this.#available.useSync(enabled ? EMPTY_PARAMS : null, {
      dedupingInterval: SHARED_READ_DEDUPING_INTERVAL,
      revalidateOnFocus: false,
    });

  /**
   * The agents changed (create / delete / sidebar refresh). Mounted
   * conversations refetch now; until a fresh list is confirmed, the chat
   * context does not trust the copy it holds.
   */
  invalidateAvailableAgents = (): void => {
    this.#availableAgentsGeneration += 1;
    this.#staleAvailableAgentScopes.set(cacheScope.get(), this.#availableAgentsGeneration);
    // A read already in flight may hold the pre-change list: later callers start anew.
    this.#availableAgentsRefresh = undefined;
    this.#set({ availableAgentsStale: true }, false, 'invalidateAvailableAgents');
    void this.#available.revalidate(AVAILABLE_AGENTS_KEY);
  };

  /**
   * The list the chat context delegates to. The local copy answers at once;
   * after an invalidation (or with nothing local) it is fetched fresh, joining
   * a request already in flight when there is no invalidation to honour.
   */
  getAvailableAgents = async (): Promise<AvailableAgentItem[]> => {
    const scope = cacheScope.get();
    const current = this.#get().availableAgents;
    const stale = this.#staleAvailableAgentScopes.has(scope);
    if (current && !stale) return current;

    // Concurrent sends of one identity share one refresh; the list stays stale
    // until it lands. A send of another identity never joins it: its raw answer
    // would hand that identity's agents to this one.
    let refresh = this.#availableAgentsRefresh;
    if (refresh?.scope !== scope) {
      const generation = this.#availableAgentsGeneration;
      const promise = this.#available
        .fetch(EMPTY_PARAMS, { fresh: stale, scope })
        .then(({ data }) => {
          // Only a read started after this identity's latest change confirms
          // its list; the store flag mirrors the identity still active.
          const changedAt = this.#staleAvailableAgentScopes.get(scope);
          if (changedAt !== undefined && changedAt <= generation)
            this.#staleAvailableAgentScopes.delete(scope);
          const activeStale = this.#staleAvailableAgentScopes.has(cacheScope.get());
          if (scope === cacheScope.get() && this.#get().availableAgentsStale !== activeStale)
            this.#set({ availableAgentsStale: activeStale }, false, 'getAvailableAgents');
          return data;
        })
        .finally(() => {
          if (this.#availableAgentsRefresh?.promise === promise)
            this.#availableAgentsRefresh = undefined;
        });
      refresh = { promise, scope };
      this.#availableAgentsRefresh = refresh;
    }

    try {
      return await refresh.promise;
    } catch (error) {
      // A failed refresh keeps the last confirmed list usable (and still stale).
      if (current) return current;
      throw error;
    }
  };

  ensureAgentDocuments = async (
    agentId?: string | null,
  ): Promise<AgentContextDocument[] | undefined> => {
    if (!agentId) return undefined;

    const cachedDocuments = this.#get().agentDocumentsMap[agentId];
    if (cachedDocuments !== undefined) return cachedDocuments;

    const pendingRequest = this.#pendingAgentDocuments.get(agentId);
    if (pendingRequest) return pendingRequest;

    const request = resolveAgentDocumentsContext({ agentId })
      .then((documents) => {
        if (documents) {
          this.#syncAgentDocuments(agentId, documents);
        }

        return documents;
      })
      .finally(() => {
        this.#pendingAgentDocuments.delete(agentId);
      });

    this.#pendingAgentDocuments.set(agentId, request);

    return request;
  };

  /**
   * Merge a partial config into `agentMap` (optimistic edits, configs other
   * stores already fetched). In-memory only: the persisted row holds confirmed
   * server values, written through `#replaceConfirmedAgentConfig`.
   */
  internal_dispatchAgentMap = (
    id: string,
    config: PartialDeep<LobeAgentConfig>,
    options?: { replaceWorkingDirDeviceIds?: string[]; workingDirByDeviceSnapshot?: boolean },
  ): void => {
    this.#config.update(id, (current) => mergeAgentConfig(current, config, options), {
      persist: false,
    });
  };

  #mergeLatestAgencyConfigPatch = (
    id: string,
    data: PartialDeep<LobeAgentConfig>,
    replaceWorkingDirDeviceIds: string[] = [],
  ): PartialDeep<LobeAgentConfig> => {
    const agencyConfigPatch = data.agencyConfig;
    if (!agencyConfigPatch) return data;

    const currentAgencyConfig = this.#get().agentMap[id]?.agencyConfig;
    const agencyConfig = merge(
      currentAgencyConfig ?? {},
      agencyConfigPatch,
    ) as PartialDeep<LobeAgentAgencyConfig>;

    // Settings editors may spread a stale agencyConfig. Only directory edits
    // explicitly identify devices whose selections should be written.
    delete agencyConfig.workingDirByDevice;
    const directoryPatch = agencyConfigPatch.workingDirByDevice;
    if (directoryPatch) {
      const entries = replaceWorkingDirDeviceIds
        .filter((deviceId) => Object.hasOwn(directoryPatch, deviceId))
        .map((deviceId) => [deviceId, directoryPatch[deviceId]]);
      if (entries.length > 0) agencyConfig.workingDirByDevice = Object.fromEntries(entries);
    }

    return { ...data, agencyConfig };
  };

  optimisticUpdateAgentConfig = async (
    id: string,
    data: PartialDeep<LobeAgentConfig>,
    signal?: AbortSignal,
    options?: AgentConfigUpdateOptions,
  ): Promise<void> => {
    const { internal_dispatchAgentMap, updateSaveStatus } = this.#get();
    const replaceWorkingDirDeviceIds = options?.replaceWorkingDirDeviceIds;
    const mergedData = this.#mergeLatestAgencyConfigPatch(id, data, replaceWorkingDirDeviceIds);
    const scope = getCacheScope();

    // 1. Optimistic update (instant UI feedback)
    internal_dispatchAgentMap(id, mergedData, { replaceWorkingDirDeviceIds });
    updateSaveStatus('saving');

    try {
      // 2. API call returns updated agent data
      const result = await agentService.updateAgentConfig(
        id,
        mergedData,
        signal,
        replaceWorkingDirDeviceIds,
      );

      // 3. Apply returned data, then invalidate the SWR key for later subscribers.
      if (result?.success && result.agent) {
        internal_dispatchAgentMap(id, result.agent, { workingDirByDeviceSnapshot: true });
        const confirmed = this.#get().agentMap[id];
        if (confirmed) this.#replaceConfirmedAgentConfig(id, scope, confirmed);
        // Refresh agent:config so cached model A cannot replay after a
        // successful model A -> B update.
        await this.#get().internal_refreshAgentConfig(id, result.agent, scope);
        this.#get().invalidateAvailableAgents();
      }
      updateSaveStatus('saved');
    } catch (error: any) {
      if (error?.name === 'AbortError' || error?.message?.includes('aborted')) {
        updateSaveStatus('idle');
      } else {
        console.error('[AgentStore] Failed to save config:', error);
        updateSaveStatus('idle');
        // A swallowed failure reads as saved and surfaces later as mysterious
        // data loss (the next refetch reverts the optimistic value) — tell the
        // user right away.
        if (options?.showErrorMessage !== false) {
          toast.error(t('saveAgentConfigFail', { ns: 'common' }));
        }
        // Roll back only agencyConfig patches: those are discrete picks the
        // server actively validates (e.g. a workspace agent binding a
        // non-workspace device is rejected), so keeping the optimistic value
        // just shows a selection that never persisted. Other config fields keep
        // the optimistic value on purpose — refetching would clobber in-flight
        // form edits on a transient failure (see #16337).
        if (data.agencyConfig) await this.#get().internal_refreshAgentConfig(id, undefined, scope);
      }
      if (options?.rethrow) throw error;
    }
  };

  optimisticUpdateAgentMeta = async (
    id: string,
    meta: AgentMetaUpdate,
    signal?: AbortSignal,
    options?: AgentMetaUpdateOptions,
  ): Promise<void> => {
    const { internal_dispatchAgentMap, updateSaveStatus } = this.#get();
    const scope = getCacheScope();
    const previous = this.#get().agentMap[id];

    // 1. Optimistic update - meta fields are at the top level of agent config
    internal_dispatchAgentMap(id, meta as PartialDeep<LobeAgentConfig>);
    updateSaveStatus('saving');

    try {
      // 2. API call returns updated agent data
      const result = await agentService.updateAgentMeta(id, meta, signal);
      if (scope !== getCacheScope()) return;

      // 3. Apply returned data, then seed related caches for later subscribers.
      if (result?.success && result.agent) {
        // Metadata saves run independently of config saves. Their full server
        // response may predate a newer config, so confirm only metadata fields.
        const confirmedMeta = Object.fromEntries(
          Object.entries(result.agent).filter(
            ([key]) => key === 'id' || AGENT_META_FIELDS.has(key),
          ),
        );
        internal_dispatchAgentMap(id, confirmedMeta);
        const confirmed = this.#get().agentMap[id];
        if (confirmed) this.#replaceConfirmedAgentConfig(id, scope, confirmed);
        await this.#get().internal_refreshAgentConfig(id, confirmed as LobeAgentConfig, scope);
        void revalidateReplica(agentListResource);
        this.#get().invalidateAvailableAgents();
      }
      updateSaveStatus('saved');
    } catch (error: any) {
      if (signal?.aborted || error?.name === 'AbortError' || error?.message?.includes('aborted')) {
        updateSaveStatus('idle');
      } else {
        console.error('[AgentStore] Failed to save meta:', error);
        updateSaveStatus('idle');
        if (options?.rethrow) {
          if (previous) this.#replaceConfirmedAgentConfig(id, scope, previous);
          else this.#config.update(id, () => undefined, { persist: false });
          throw error;
        }
      }
    }
  };

  internal_refreshAgentConfig = async (
    id: string,
    updatedAgent?: LobeAgentConfig,
    scope = getCacheScope(),
  ): Promise<void> => {
    /** Keep related agent and builtin-agent snapshots current after a successful edit. */
    const slugs = Object.entries(this.#get().builtinAgentIdMap)
      .filter(([, agentId]) => agentId === id)
      .map(([slug]) => slug);

    /**
     * Reuse the authoritative update response (the replica already holds it);
     * other mutations still need a network refresh.
     */
    if (updatedAgent) {
      slugs.forEach((slug) =>
        this.#get().internal_replaceBuiltinAgent(slug, updatedAgent as AgentItem, scope),
      );
      return;
    }

    if (scope !== getCacheScope()) return;
    await Promise.all([
      this.#config.revalidate(id),
      ...slugs.map((slug) => this.#get().refreshBuiltinAgent(slug)),
    ]);
  };

  internal_createAbortController = (key: keyof AgentSliceState): AbortController => {
    const abortController = this.#get()[key] as AbortController;
    if (abortController) abortController.abort(MESSAGE_CANCEL_FLAT);
    const controller = new AbortController();
    this.#set({ [key]: controller }, false, 'internal_createAbortController');

    return controller;
  };
}

export type AgentSliceAction = Pick<AgentSliceActionImpl, keyof AgentSliceActionImpl>;
