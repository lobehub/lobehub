import { isDesktop, randomAgentName } from '@lobechat/const';
import { type AgentContextDocument } from '@lobechat/context-engine';
import { getHeterogeneousTypeLabel } from '@lobechat/heterogeneous-agents';
import {
  isChatGroupSessionId,
  type LobeAgentAgencyConfig,
  pruneWorkingDirByDeviceDeletes,
} from '@lobechat/types';
import { getSingletonAnalyticsOptional } from '@lobehub/analytics';
import { toast } from '@lobehub/ui/base-ui';
import isEqual from 'fast-deep-equal';
import { t } from 'i18next';
import { produce } from 'immer';
import type { SWRResponse } from 'swr';
import type { PartialDeep } from 'type-fest';

import { getActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { MESSAGE_CANCEL_FLAT } from '@/const/message';
import { mutate, useClientDataSWR, useClientDataSWRWithSync } from '@/libs/swr';
import { agentConfigKeys } from '@/libs/swr/keys';
import type { AvailableAgentItem, CreateAgentParams, CreateAgentResult } from '@/services/agent';
import { agentService, AVAILABLE_AGENTS_CONTEXT_QUERY_LIMIT } from '@/services/agent';
import {
  type AgentDocumentListItem,
  agentDocumentService,
  agentDocumentSWRKeys,
  resolveAgentDocumentsContext,
} from '@/services/agentDocument';
import { aiAgentService } from '@/services/aiAgent';
import { ragService } from '@/services/rag';
import { useGlobalStore } from '@/store/global';
import { globalGeneralSelectors } from '@/store/global/selectors';
import type { StoreSetter } from '@/store/types';
import { getUserStoreState } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';
import type {
  AgentItem,
  LobeAgentChatConfig,
  LobeAgentConfig,
  RuntimeEnvConfig,
} from '@/types/agent';
import { isChunkingUnsupported } from '@/utils/isChunkingUnsupported';
import { merge } from '@/utils/merge';

import type { AgentStore } from '../../store';
import { heteroAgentDefaultName } from '../../utils/heteroAgentDefaultName';
import { setLocalAgentWorkingDirectory } from '../../utils/localAgentWorkingDirectoryStorage';
import type { AgentSliceState, LoadingState, SaveStatus } from './initialState';

type AgentMetaUpdate = Partial<
  Pick<
    AgentItem,
    | 'avatar'
    | 'backgroundColor'
    | 'description'
    | 'marketIdentifier'
    | 'metadata'
    | 'name'
    | 'profile'
    | 'societyId'
    | 'tags'
    | 'title'
  >
>;
type AgencyConfigPatch = PartialDeep<LobeAgentAgencyConfig>;

interface AgentConfigUpdateOptions {
  /** Propagate the persistence failure so a scoped editor can render failed + Retry. */
  rethrow?: boolean;
  /** Keep generic error messaging for ordinary config controls. @default true */
  showErrorMessage?: boolean;
}

const preserveWorkingDirDeleteMarkers = (
  merged: LobeAgentAgencyConfig,
  patch: AgencyConfigPatch,
): void => {
  const incoming = patch.workingDirByDevice;
  if (!incoming) return;

  const deletions = Object.keys(incoming).filter((key) => incoming[key] === undefined);
  if (deletions.length === 0) return;

  const workingDirByDevice = {
    ...merged.workingDirByDevice,
  } as Record<string, string | undefined>;

  for (const key of deletions) {
    workingDirByDevice[key] = undefined;
  }

  merged.workingDirByDevice = workingDirByDevice as Record<string, string>;
};

/**
 * Agent Slice Actions
 * Handles agent CRUD operations (config/meta updates)
 */

type Setter = StoreSetter<AgentStore>;
export const createAgentSlice = (set: Setter, get: () => AgentStore, _api?: unknown) =>
  new AgentSliceActionImpl(set, get, _api);

/**
 * Resolve with `promise`, or reject as soon as `signal` aborts.
 *
 * A parse promise is shared between concurrent sends, so it cannot carry any one
 * caller's signal. Racing it here is what lets a send stop waiting on a parse
 * another send started.
 */
const raceAbortSignal = <T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> => {
  if (!signal) return promise;

  const abortError = () => {
    const error = new Error('Knowledge file hydration aborted');
    error.name = 'AbortError';

    return error;
  };

  if (signal.aborted) return Promise.reject(abortError());

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());

    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
};

export class AgentSliceActionImpl {
  readonly #get: () => AgentStore;
  readonly #set: Setter;
  readonly #pendingAgentDocuments = new Map<string, Promise<AgentContextDocument[] | undefined>>();
  readonly #pendingAgentFileContents = new Map<string, Promise<string>>();
  readonly #updateAgentConfigControllers = new Map<string, AbortController>();
  readonly #updateAgentMetaControllers = new Map<string, AbortController>();

  constructor(set: Setter, get: () => AgentStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

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

  #syncAgentFileContent = (agentId: string, fileId: string, content: string) => {
    const agentMap = produce(this.#get().agentMap, (draft) => {
      // `agentMap` is typed as the agents row, which carries no `files` column of
      // its own — the config selectors widen it to `LobeAgentConfig` for exactly
      // this reason (`getAgentConfigById`), so do the same here.
      const agent = draft[agentId] as LobeAgentConfig | undefined;
      const file = agent?.files?.find((item) => item?.id === fileId);
      if (file) file.content = content;
    });

    if (isEqual(this.#get().agentMap, agentMap)) return;

    this.#set({ agentMap }, false, 'syncAgentFileContent');
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
    // Builder conversation produces one; the builder may replace it later. This
    // lives here rather than in the create endpoint because the language only
    // resolves on the client (`auto` follows the browser). A caller that already
    // carries a name — e.g. a market agent — keeps it.
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
          : randomAgentName(locale)),
    };

    const result = await agentService.createAgent({ ...params, config });
    this.#get().invalidateAvailableAgents();

    // Track new agent creation analytics
    const analytics = getSingletonAnalyticsOptional();
    if (analytics) {
      const userStore = getUserStoreState();
      const userId = userProfileSelectors.userId(userStore);

      analytics.track({
        name: 'new_agent_created',
        properties: {
          agent_id: result.agentId,
          assistant_name: params.config?.title || 'Untitled Agent',
          assistant_tags: params.config?.tags || [],
          user_id: userId || 'anonymous',
        },
      });
    }

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

  updateAgentMetaById = async (agentId: string, meta: AgentMetaUpdate): Promise<void> => {
    if (!agentId) return;

    const controller = this.#createAgentScopedAbortController(
      this.#updateAgentMetaControllers,
      agentId,
    );

    try {
      await this.#get().optimisticUpdateAgentMeta(agentId, meta, controller.signal);
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

  useFetchAgentConfig = (
    isLogin: boolean | undefined,
    agentId: string,
  ): SWRResponse<LobeAgentConfig> => {
    const swrKey =
      isLogin === true && agentId && !isChatGroupSessionId(agentId)
        ? agentConfigKeys.config(agentId)
        : null;

    return useClientDataSWRWithSync<LobeAgentConfig>(
      swrKey,
      async () => {
        const data = await agentService.getAgentConfigById(agentId);
        return data as LobeAgentConfig;
      },
      {
        onData: (data) => {
          // A successful fetch that resolves to null means the agent doesn't
          // exist or the caller lost access (e.g. a workspace agent switched
          // back to private) — a settled state, not "still loading".
          if (!data) {
            this.#markAgentNotFound(agentId);
            return;
          }
          this.#clearAgentNotFound(agentId);
          // This endpoint returns a complete, authoritative profile snapshot.
          // Replace the cached entry instead of applying patch semantics: fields
          // cleared on the server (for example editorData: null) may be omitted
          // from the response and must not survive from an older local profile.
          if (!isEqual(this.#get().agentMap[agentId], data)) {
            this.#set(
              (state) => ({ agentMap: { ...state.agentMap, [agentId]: data } }),
              false,
              'fetchAgentConfig',
            );
          }
          // Only adopt the fetched agent as the active one when nothing is
          // active yet. The active agent is owned by the route-level sync
          // (AgentIdSync on desktop/mobile, the popup pages' own setState).
          // A background or secondary config fetch — e.g. the inbox config
          // requested by the home input, a side-panel copilot, or another
          // open tab — must NOT hijack `activeAgentId` away from the routed
          // agent, which would otherwise flash the conversation header/welcome
          // back to the inbox ("Lobe AI") agent.
          if (!this.#get().activeAgentId) {
            this.#set({ activeAgentId: data.id }, false, 'fetchAgentConfig');
          }
          this.#clearAgentConfigError(agentId);
        },
        onError: (error) => {
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
      },
    );
  };

  useFetchServerDefaultHeterogeneousCapability = (enabled: boolean) =>
    useClientDataSWR(enabled ? agentConfigKeys.serverDefaultHeterogeneousCapability() : null, () =>
      aiAgentService.getServerDefaultHeterogeneousCapability(),
    );

  /**
   * Re-trigger the agent config fetch after a failure. Clears the recorded
   * error first so consumers fall back to the loading skeleton, then
   * revalidates every SWR entry for this agent (keys may carry a workspace
   * suffix, hence the filter form).
   */
  retryAgentConfigFetch = async (agentId?: string): Promise<void> => {
    const id = agentId ?? this.#get().activeAgentId;
    if (!id) return;

    this.#clearAgentConfigError(id);

    await mutate(
      (key) => Array.isArray(key) && key[0] === agentConfigKeys.config.root && key[1] === id,
    );
  };

  #markAgentNotFound = (agentId: string) => {
    const { agentNotFoundMap, agentMap } = this.#get();
    if (agentNotFoundMap[agentId] && !agentMap[agentId]) return;

    this.#set(
      (state) => {
        // Also drop the previously cached config: surfaces reading `agentMap`
        // (title/avatar in the sidebar or header) must not keep showing an
        // agent the viewer lost access to next to the 404 content area.
        const nextAgentMap = { ...state.agentMap };
        delete nextAgentMap[agentId];
        return {
          agentMap: nextAgentMap,
          agentNotFoundMap: { ...state.agentNotFoundMap, [agentId]: true },
        };
      },
      false,
      'markAgentNotFound',
    );
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

  useHydrateAgentConfig = (
    isLogin: boolean | undefined,
    agentId: string,
  ): SWRResponse<LobeAgentConfig> => {
    const swrKey =
      isLogin === true && agentId && !isChatGroupSessionId(agentId)
        ? agentConfigKeys.config(agentId)
        : null;

    return useClientDataSWRWithSync<LobeAgentConfig>(
      swrKey,
      async () => {
        const data = await agentService.getAgentConfigById(agentId);
        return data as LobeAgentConfig;
      },
      {
        onData: (data) => {
          if (!data) {
            this.#markAgentNotFound(agentId);
            return;
          }
          this.#clearAgentNotFound(agentId);
          this.#get().internal_dispatchAgentMap(agentId, data);
        },
      },
    );
  };

  useFetchAgentDocuments = (agentId?: string | null): SWRResponse<AgentDocumentListItem[]> => {
    return useClientDataSWRWithSync<AgentDocumentListItem[]>(
      agentId ? agentDocumentSWRKeys.documentsList(agentId) : null,
      async () => agentDocumentService.listDocuments({ agentId: agentId! }),
      {
        revalidateOnFocus: false,
      },
    );
  };

  useFetchAvailableAgents = (enabled: boolean): SWRResponse<AvailableAgentItem[]> => {
    return useClientDataSWRWithSync<AvailableAgentItem[]>(
      enabled ? agentConfigKeys.available() : null,
      () => agentService.queryAgents({ limit: AVAILABLE_AGENTS_CONTEXT_QUERY_LIMIT }),
      {
        onData: (data) => {
          this.#set({ availableAgents: data }, false, 'useFetchAvailableAgents');
        },
        revalidateOnFocus: false,
      },
    );
  };

  invalidateAvailableAgents = (): void => {
    this.#set({ availableAgents: undefined }, false, 'invalidateAvailableAgents');
    void mutate(agentConfigKeys.available());
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
   * Hydrate the parsed content of the agent's enabled knowledge files.
   *
   * The agent config carries each enabled file's cached `documents.content`, so
   * a file whose parse never ran — uploaded through the file manager rather than
   * as a chat attachment — arrives with no content at all, and the chat context
   * builder drops those from the prompt entirely. The model then answers as if
   * the file had never been attached, with nothing to tell the user why. Parse
   * them on demand through `document.parseFileContent`, the endpoint the
   * attachment upload already uses, and write the result back into the config
   * the builder reads.
   *
   * Resolves rather than rejects when a parse fails or the send is aborted: that
   * file stays out of the prompt, which is the behaviour before this hydration
   * existed. One parse is shared per file id and each send races it against its
   * own signal, so pressing Stop releases that send alone — the parse keeps
   * running for whoever is still waiting on it.
   */
  ensureAgentFileContents = async (
    agentId?: string | null,
    signal?: AbortSignal,
  ): Promise<void> => {
    if (!agentId) return;

    // `contextEngineering` reads the knowledge files off the *active* agent
    // (`currentAgentConfig`) rather than the agent the operation targets, and a
    // group run targets a member while the active agent is the supervisor. Only
    // hydrate when the two already agree: filling a different agent's cache
    // would push its file content into this prompt.
    if (agentId !== this.#get().activeAgentId) return;

    const files = (this.#get().agentMap[agentId] as LobeAgentConfig | undefined)?.files ?? [];
    // A cached parse passes through even when it is empty, and a file with no id
    // has no document to parse under.
    const missing = files.filter(
      (file) =>
        file?.enabled === true &&
        typeof file.content !== 'string' &&
        !!file.id &&
        !isChunkingUnsupported(file.type ?? ''),
    );
    if (missing.length === 0) return;

    await Promise.all(
      missing.map(async (file) => {
        const fileId = file.id!;

        // The next send can start before this parse settles; one shared promise
        // per file id keeps concurrent sends from racing into duplicate parse calls.
        let request = this.#pendingAgentFileContents.get(fileId);
        if (!request) {
          // No caller's signal is attached to the shared parse: one send pressing
          // Stop would otherwise cancel the parse another send is waiting on and
          // drop that file from its prompt, which is the failure this hydration
          // exists to remove.
          const pending = ragService
            .parseFileContent(fileId)
            .then((document) => document.content ?? '');

          // Release the entry when the parse settles rather than when a caller
          // stops waiting on it, so a send that aborts early does not leave the
          // next one to start a second parse for the same file.
          const release = () => {
            this.#pendingAgentFileContents.delete(fileId);
          };
          pending.then(release, release);

          request = pending;
          this.#pendingAgentFileContents.set(fileId, request);
        }

        try {
          // Publish each file as it lands rather than after the whole batch: a
          // send that starts while a slower file is still parsing would otherwise
          // find this one neither cached nor in flight and parse it again.
          this.#syncAgentFileContent(agentId, fileId, await raceAbortSignal(request, signal));
        } catch (error) {
          // Pressing Stop stops this send from waiting; that is a cancellation,
          // not a failure worth reporting. Either way the file stays out of this
          // prompt.
          if (!signal?.aborted) {
            console.error('[AgentStore] Failed to parse knowledge file:', fileId, error);
          }
        }
      }),
    );
  };

  internal_dispatchAgentMap = (id: string, config: PartialDeep<LobeAgentConfig>): void => {
    const agentMap = produce(this.#get().agentMap, (draft) => {
      if (!draft[id]) {
        draft[id] = config;
      } else {
        draft[id] = merge(draft[id], config);
        // The character sheet is authored as one document — `AgentModel`
        // replaces it rather than merging — so mirror that here, or a trait the
        // user just cleared reappears until the next full fetch.
        if (Object.hasOwn(config, 'profile')) draft[id].profile = config.profile;
        // merge() can't drop keys; honor `undefined` as a per-device delete so
        // clearing a working directory takes effect optimistically.
        pruneWorkingDirByDeviceDeletes(draft[id].agencyConfig, config.agencyConfig);
      }
    });

    if (isEqual(this.#get().agentMap, agentMap)) return;

    this.#set({ agentMap }, false, 'dispatchAgentMap');
  };

  #mergeLatestAgencyConfigPatch = (
    id: string,
    data: PartialDeep<LobeAgentConfig>,
  ): PartialDeep<LobeAgentConfig> => {
    const agencyConfigPatch = data.agencyConfig;
    if (!agencyConfigPatch) return data;

    const currentAgencyConfig = this.#get().agentMap[id]?.agencyConfig;
    const agencyConfig = merge(
      currentAgencyConfig ?? {},
      agencyConfigPatch,
    ) as LobeAgentAgencyConfig;

    pruneWorkingDirByDeviceDeletes(agencyConfig, agencyConfigPatch);
    preserveWorkingDirDeleteMarkers(agencyConfig, agencyConfigPatch);

    return { ...data, agencyConfig };
  };

  optimisticUpdateAgentConfig = async (
    id: string,
    data: PartialDeep<LobeAgentConfig>,
    signal?: AbortSignal,
    options?: AgentConfigUpdateOptions,
  ): Promise<void> => {
    const { internal_dispatchAgentMap, updateSaveStatus } = this.#get();
    const mergedData = this.#mergeLatestAgencyConfigPatch(id, data);

    // 1. Optimistic update (instant UI feedback)
    internal_dispatchAgentMap(id, mergedData);
    updateSaveStatus('saving');

    try {
      // 2. API call returns updated agent data
      const result = await agentService.updateAgentConfig(id, mergedData, signal);

      // 3. Apply returned data, then invalidate the SWR key for later subscribers.
      if (result?.success && result.agent) {
        internal_dispatchAgentMap(id, result.agent);
        // Refresh agent:config so cached model A cannot replay after a
        // successful model A -> B update.
        await this.#get().internal_refreshAgentConfig(id);
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
        if (data.agencyConfig) await this.#get().internal_refreshAgentConfig(id);
      }
      if (options?.rethrow) throw error;
    }
  };

  optimisticUpdateAgentMeta = async (
    id: string,
    meta: AgentMetaUpdate,
    signal?: AbortSignal,
  ): Promise<void> => {
    const { internal_dispatchAgentMap, updateSaveStatus } = this.#get();

    // 1. Optimistic update - meta fields are at the top level of agent config
    internal_dispatchAgentMap(id, meta as PartialDeep<LobeAgentConfig>);
    updateSaveStatus('saving');

    try {
      // 2. API call returns updated agent data
      const result = await agentService.updateAgentMeta(id, meta, signal);

      // 3. Use returned data directly (no refetch needed!)
      if (result?.success && result.agent) {
        internal_dispatchAgentMap(id, result.agent);
        this.#get().invalidateAvailableAgents();
      }
      updateSaveStatus('saved');
    } catch (error: any) {
      if (error?.name === 'AbortError' || error?.message?.includes('aborted')) {
        updateSaveStatus('idle');
      } else {
        console.error('[AgentStore] Failed to save meta:', error);
        updateSaveStatus('idle');
      }
    }
  };

  internal_refreshAgentConfig = async (id: string): Promise<void> => {
    await mutate(agentConfigKeys.config(id));
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
