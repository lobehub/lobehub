import { type NavigateFunction } from 'react-router-dom';

import { chatGroupService } from '@/services/chatGroup';
import { documentService } from '@/services/document';
import { getAgentStoreState } from '@/store/agent';
import { agentSelectors, builtinAgentSelectors } from '@/store/agent/selectors';
import { getChatGroupStoreState } from '@/store/agentGroup';
import { useChatStore } from '@/store/chat';
import { type HomeStore } from '@/store/home/store';
import { type StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import { type StarterMode } from './initialState';

const n = setNamespace('homeInput');

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

  sendAsAgent = async (message: string): Promise<string> => {
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
          title: message?.slice(0, 50) || 'New Agent',
        },
      });

      // 3. Navigate to Agent profile page
      const { navigate } = this.#get();
      if (navigate) {
        navigate(`/agent/${result.agentId}/profile`);
      }

      // 4. Refresh agent list
      this.#get().refreshAgentList();

      // 5. Update agentBuilder's model config and send initial message
      if (result.agentId) {
        const { sendMessage } = useChatStore.getState();
        const agentBuilderId = builtinAgentSelectors.agentBuilderId(agentState);

        // Update agentBuilder's model to match inbox selection
        if (agentBuilderId && model && provider) {
          await agentState.updateAgentConfigById(agentBuilderId, { model, provider });
        }

        await sendMessage({
          context: { agentId: agentBuilderId!, scope: 'agent_builder' },
          message,
        });
      }

      // 6. Clear mode
      this.#set({ inputActiveMode: null }, false, n('sendAsAgent/clearMode'));

      return result.agentId!;
    } finally {
      this.#set({ homeInputLoading: false }, false, n('sendAsAgent/end'));
    }
  };

  sendAsGroup = async (message: string): Promise<string> => {
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

      // 2. Create new Group with inherited model/provider for orchestrator
      const { group } = await chatGroupService.createGroup({
        config: {
          systemPrompt: message,
        },
        title: message?.slice(0, 50) || 'New Group',
      });

      // 3. Load groups and refresh
      const groupStore = getChatGroupStoreState();
      await groupStore.loadGroups();

      // 4. Refresh sidebar agent list
      this.#get().refreshAgentList();

      // 5. Navigate to Group profile page
      const { navigate } = this.#get();
      if (navigate) {
        navigate(`/group/${group.id}/profile`);
      }

      // 6. Update groupAgentBuilder's model config and send initial message
      const groupAgentBuilderId = builtinAgentSelectors.groupAgentBuilderId(agentState);

      if (groupAgentBuilderId) {
        // Update groupAgentBuilder's model to match inbox selection
        if (model && provider) {
          await agentState.updateAgentConfigById(groupAgentBuilderId, { model, provider });
        }

        const { sendMessage } = useChatStore.getState();
        await sendMessage({
          context: { agentId: groupAgentBuilderId, scope: 'group_agent_builder' },
          message,
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
    console.log('sendAsResearch:', message);

    // Clear mode
    this.#set({ inputActiveMode: null }, false, n('sendAsResearch'));
  };

  sendAsWrite = async (message: string): Promise<string> => {
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
        fileType: 'custom/document',
        title: message?.slice(0, 50) || 'Untitled',
      });

      // 3. Navigate to Page
      const { navigate } = this.#get();
      if (navigate) {
        navigate(`/page/${newDoc.id}`);
      }

      // 4. Update pageAgent's model config and send initial message
      const pageAgentId = builtinAgentSelectors.pageAgentId(agentState);

      if (pageAgentId) {
        // Update pageAgent's model to match inbox selection
        if (model && provider) {
          await agentState.updateAgentConfigById(pageAgentId, { model, provider });
        }

        const { sendMessage } = useChatStore.getState();
        await sendMessage({
          context: { agentId: pageAgentId, scope: 'page' },
          message,
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

  setNavigate = (navigate: NavigateFunction): void => {
    this.#set({ navigate }, false, n('setNavigate'));
  };
}

export type HomeInputAction = Pick<HomeInputActionImpl, keyof HomeInputActionImpl>;
