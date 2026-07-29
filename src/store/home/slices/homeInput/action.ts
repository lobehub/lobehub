import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { CUSTOM_DOCUMENT_FILE_TYPE } from '@lobechat/const';
import type { ContextSelection, PageSelection } from '@lobechat/types';

import { stableWorkspaceAwareNavigate } from '@/features/Workspace/stableWorkspaceAwareNavigate';
import { chatGroupService } from '@/services/chatGroup';
import { documentService } from '@/services/document';
import { getAgentStoreState } from '@/store/agent';
import { agentByIdSelectors, agentSelectors, builtinAgentSelectors } from '@/store/agent/selectors';
import { getChatGroupStoreState } from '@/store/agentGroup';
import { getAiInfraStoreState } from '@/store/aiInfra';
import { aiModelSelectors, aiProviderSelectors } from '@/store/aiInfra/selectors';
import { useChatStore } from '@/store/chat';
import { useGlobalStore } from '@/store/global';
import { useGroupProfileStore } from '@/store/groupProfile';
import { type HomeStore } from '@/store/home/store';
import { type StoreSetter } from '@/store/types';
import { markdownToTxt } from '@/utils/markdownToTxt';
import { setNamespace } from '@/utils/storeDebug';

import { type StarterMode } from './initialState';

const n = setNamespace('homeInput');

interface SendMessageWithEditorParams {
  contextSelections?: ContextSelection[];
  editorData?: Record<string, any>;
  groupId?: string;
  message: string;
  pageSelections?: PageSelection[];
  workspaceSlug?: string | null;
}

/**
 * Make sure a builtin agent (agent-builder / group-agent-builder / page-agent)
 * is hydrated into both `builtinAgentIdMap` and `agentMap` before we read its
 * id and call sendMessage. Without this, the create-Agent / create-Group /
 * create-Page flows can race against the host page's `useInitBuiltinAgent`:
 * `builtinAgentIdMap[slug]` is still undefined, so sendMessage gets
 * `agentId: undefined` and silently early-returns. Symptom: navigation lands
 * on the builder page but the conversation never starts.
 */
const ensureBuiltinAgentHydrated = async (slug: string): Promise<string | undefined> => {
  const state = getAgentStoreState();
  const cachedId = state.builtinAgentIdMap[slug];
  if (cachedId && state.agentMap[cachedId]) return cachedId;

  await state.refreshBuiltinAgent(slug);
  return getAgentStoreState().builtinAgentIdMap[slug];
};

/**
 * Point a builtin helper agent (agent-builder / group-agent-builder / page-agent)
 * at the model the user just picked in the inbox — but only when that row is the
 * user's own.
 *
 * A personal-mode builtin is a private per-user row, so inheriting the inbox
 * model is both safe and expected: without it the first builder request runs on
 * the builtin's static default, which may name a provider the user never enabled.
 *
 * The workspace-scoped row of the same slug is shared by every member, so a
 * personal preference must not repoint it — that write both broke for
 * non-creators and silently changed the model for everyone else (LOBE-12374).
 * The single exception is a shared row whose own model cannot be invoked in this
 * deployment; leaving it would fail the request outright, so it is repaired once.
 *
 * Ownership is read off the hydrated row rather than a `workspaceSlug` argument,
 * because some call sites (e.g. the command menu) omit that argument while still
 * running inside a workspace.
 */
const syncBuiltinAgentModel = async (
  builtinAgentId: string,
  model?: string,
  provider?: string,
): Promise<void> => {
  if (!model || !provider) return;

  const state = getAgentStoreState();
  const builtin = agentByIdSelectors.getAgentById(builtinAgentId)(state);

  if (builtin?.workspaceId) {
    // The shared row keeps whatever model the workspace configured — unless that
    // model isn't invocable here (a provider this deployment never enabled, a
    // retired model id), in which case the builder request would fail outright.
    // Repair it once instead of leaving the flow broken.
    const aiInfraState = getAiInfraStoreState();

    // Before the provider runtime state hydrates, `enabledAiModels` is undefined
    // and EVERY model would look unusable — repairing then would overwrite the
    // workspace's model with this member's pick on a mere race. Unknown ≠ invalid.
    if (!aiProviderSelectors.isInitAiProviderRuntimeState(aiInfraState)) return;

    const builtinConfig = agentSelectors.getAgentConfigById(builtinAgentId)(state);
    const currentModel = builtinConfig?.model;
    const currentProvider = builtinConfig?.provider;
    const isUsable =
      !!currentModel &&
      !!currentProvider &&
      !!aiModelSelectors.getEnabledModelById(currentModel, currentProvider)(aiInfraState);

    if (isUsable) return;
  }

  await state.updateAgentConfigById(builtinAgentId, { model, provider });
};

type Setter = StoreSetter<HomeStore>;
export const createHomeInputSlice = (set: Setter, get: () => HomeStore, _api?: unknown) =>
  new HomeInputActionImpl(set, get, _api);

export class HomeInputActionImpl {
  readonly #get: () => HomeStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => HomeStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  clearInputMode = (): void => {
    this.#set({ inputActiveMode: null }, false, n('clearInputMode'));
  };

  sendAsAgent = async ({
    contextSelections,
    editorData,
    groupId,
    message,
    pageSelections,
    workspaceSlug,
  }: SendMessageWithEditorParams): Promise<string> => {
    this.#set({ homeInputLoading: true }, false, n('sendAsAgent/start'));

    try {
      const agentState = getAgentStoreState();

      // 1. Get model/provider config from inbox agent
      const inboxAgentId = builtinAgentSelectors.inboxAgentId(agentState);
      const inboxConfig = inboxAgentId
        ? agentSelectors.getAgentConfigById(inboxAgentId)(agentState)
        : null;
      const model = inboxConfig?.model;
      const provider = inboxConfig?.provider;

      // 2. Create new Agent with inherited model/provider
      const result = await agentState.createAgent({
        config: {
          model,
          provider,
          systemRole: message,
          title: markdownToTxt(message ?? '').slice(0, 50) || 'New Agent',
        },
        groupId,
      });

      // Sync the editing target into the chat store BEFORE the builder message
      // is sent. Gateway mode reads `chatStore.activeAgentId` at send time to
      // forward `editingAgentId` (see gateway.ts executeGatewayAgent), and the
      // AgentBuilder tool `onAfterCall` reads it to refresh the correct agent's
      // config. Setting it here — instead of waiting for AgentBuilderProvider's
      // mount effect — removes the create-time race where the first tool call
      // could target / refresh the wrong agent (left profile not refreshed).
      if (result.agentId) {
        useChatStore.setState(
          { activeAgentId: result.agentId },
          false,
          'sendAsAgent/syncEditingAgentId',
        );
      }

      if (message.trim()) {
        useGlobalStore.getState().toggleAgentBuilderPanel(true);
      }

      // 3. Navigate to Agent profile page
      stableWorkspaceAwareNavigate(`/agent/${result.agentId}/profile`);

      // 4. Refresh agent list
      this.#get().refreshAgentList();

      // 5. Send the initial builder message
      if (result.agentId) {
        const { sendMessage } = useChatStore.getState();
        // Ensure agentBuilder is loaded before reading its id — the host
        // AgentBuilder component's useInitBuiltinAgent only fires after this
        // navigation completes, which would otherwise race with sendMessage.
        const agentBuilderId = await ensureBuiltinAgentHydrated(BUILTIN_AGENT_SLUGS.agentBuilder);

        if (agentBuilderId) {
          await syncBuiltinAgentModel(agentBuilderId, model, provider);

          await sendMessage({
            context: {
              agentId: agentBuilderId,
              scope: 'agent_builder',
              ...(workspaceSlug ? { workspaceSlug } : {}),
            },
            contextSelections,
            editorData,
            message,
            pageSelections,
          });
        }
      }

      // 6. Clear mode
      this.#set({ inputActiveMode: null }, false, n('sendAsAgent/clearMode'));

      return result.agentId!;
    } finally {
      this.#set({ homeInputLoading: false }, false, n('sendAsAgent/end'));
    }
  };

  sendAsGroup = async ({
    contextSelections,
    editorData,
    groupId,
    message,
    pageSelections,
    workspaceSlug,
  }: SendMessageWithEditorParams): Promise<string> => {
    this.#set({ homeInputLoading: true }, false, n('sendAsGroup/start'));

    try {
      const agentState = getAgentStoreState();

      // 1. Get model/provider config from inbox agent
      const inboxAgentId = builtinAgentSelectors.inboxAgentId(agentState);
      const inboxConfig = inboxAgentId
        ? agentSelectors.getAgentConfigById(inboxAgentId)(agentState)
        : null;
      const model = inboxConfig?.model;
      const provider = inboxConfig?.provider;

      // 2. Create new Group
      const { group } = await chatGroupService.createGroup({
        config: {
          systemPrompt: message,
        },
        groupId,
        title: markdownToTxt(message ?? '').slice(0, 50) || 'New Group',
      });

      // 3. Load groups and refresh
      const groupStore = getChatGroupStoreState();
      await groupStore.loadGroups();

      // 4. Refresh sidebar agent list
      this.#get().refreshAgentList();

      if (message.trim()) {
        useGroupProfileStore.getState().setChatPanelExpanded(true);
      }

      // 5. Navigate to Group profile page
      stableWorkspaceAwareNavigate(`/group/${group.id}/profile`);

      // 6. Send the initial builder message.
      // Hydrate first so we don't race with the group profile page's own init.
      const groupAgentBuilderId = await ensureBuiltinAgentHydrated(
        BUILTIN_AGENT_SLUGS.groupAgentBuilder,
      );

      if (groupAgentBuilderId) {
        await syncBuiltinAgentModel(groupAgentBuilderId, model, provider);

        const { sendMessage } = useChatStore.getState();
        await sendMessage({
          context: {
            agentId: groupAgentBuilderId,
            scope: 'group_agent_builder',
            ...(workspaceSlug ? { workspaceSlug } : {}),
          },
          contextSelections,
          editorData,
          message,
          pageSelections,
        });
      }

      // 7. Clear mode
      this.#set({ inputActiveMode: null }, false, n('sendAsGroup/clearMode'));

      return group.id;
    } finally {
      this.#set({ homeInputLoading: false }, false, n('sendAsGroup/end'));
    }
  };

  sendAsResearch = async (message: string): Promise<void> => {
    // TODO: Implement DeepResearch mode
    console.info('sendAsResearch:', message);

    // Clear mode
    this.#set({ inputActiveMode: null }, false, n('sendAsResearch'));
  };

  sendAsWrite = async ({
    contextSelections,
    editorData,
    message,
    pageSelections,
    workspaceSlug,
  }: SendMessageWithEditorParams): Promise<string> => {
    this.#set({ homeInputLoading: true }, false, n('sendAsWrite/start'));

    try {
      const agentState = getAgentStoreState();

      // 1. Get model/provider config from inbox agent
      const inboxAgentId = builtinAgentSelectors.inboxAgentId(agentState);
      const inboxConfig = inboxAgentId
        ? agentSelectors.getAgentConfigById(inboxAgentId)(agentState)
        : null;
      const model = inboxConfig?.model;
      const provider = inboxConfig?.provider;

      // 2. Create new Document
      const newDoc = await documentService.createDocument({
        editorData: '{}',
        fileType: CUSTOM_DOCUMENT_FILE_TYPE,
        title: markdownToTxt(message ?? '').slice(0, 50) || 'Untitled',
      });

      // 3. Navigate to Page
      stableWorkspaceAwareNavigate(`/page/${newDoc.id}`);

      // 4. Send the initial page-agent message. Hydrate first to avoid the same
      // race the agent/group flows hit.
      const pageAgentId = await ensureBuiltinAgentHydrated(BUILTIN_AGENT_SLUGS.pageAgent);

      if (pageAgentId) {
        await syncBuiltinAgentModel(pageAgentId, model, provider);

        const { sendMessage } = useChatStore.getState();
        await sendMessage({
          // Pass the freshly created document id explicitly. The new PageEditor
          // has not mounted yet, so the page editor runtime singleton may still
          // be bound to the previously open document — relying on its fallback
          // here would scope server-side PageAgent tools to the wrong document.
          context: {
            agentId: pageAgentId,
            documentId: newDoc.id,
            scope: 'page',
            ...(workspaceSlug ? { workspaceSlug } : {}),
          },
          contextSelections,
          editorData,
          message,
          pageSelections,
        });
      }

      // 5. Clear mode
      this.#set({ inputActiveMode: null }, false, n('sendAsWrite/clearMode'));

      return newDoc.id;
    } finally {
      this.#set({ homeInputLoading: false }, false, n('sendAsWrite/end'));
    }
  };

  setInputActiveMode = (mode: StarterMode): void => {
    this.#set({ inputActiveMode: mode }, false, n('setInputActiveMode', mode));
  };
}

export type HomeInputAction = Pick<HomeInputActionImpl, keyof HomeInputActionImpl>;
