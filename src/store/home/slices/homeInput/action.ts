import type { NavigateFunction } from 'react-router-dom';
import type { StateCreator } from 'zustand/vanilla';

import { chatGroupService } from '@/services/chatGroup';
import { documentService } from '@/services/document';
import { getAgentStoreState } from '@/store/agent';
import { agentSelectors, builtinAgentSelectors } from '@/store/agent/selectors';
import { getChatGroupStoreState } from '@/store/agentGroup';
import { useChatStore } from '@/store/chat';
import type { HomeStore } from '@/store/home/store';
import { setNamespace } from '@/utils/storeDebug';

import type { StarterMode } from './initialState';

const n = setNamespace('homeInput');

export interface HomeInputAction {
  clearInputMode: () => void;
  sendAsAgent: (message: string) => Promise<string>;
  sendAsGroup: (message: string) => Promise<string>;
  sendAsImage: () => void;
  sendAsResearch: (message: string) => Promise<void>;
  sendAsWrite: (message: string) => Promise<string>;
  setInputActiveMode: (mode: StarterMode) => void;
  setNavigate: (navigate: NavigateFunction) => void;
}

export const createHomeInputSlice: StateCreator<
  HomeStore,
  [['zustand/devtools', never]],
  [],
  HomeInputAction
> = (set, get) => ({
  clearInputMode: () => {
    set({ inputActiveMode: null }, false, n('clearInputMode'));
  },

  sendAsAgent: async (message) => {
    set({ homeInputLoading: true }, false, n('sendAsAgent/start'));

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
      const { navigate } = get();
      if (navigate) {
        navigate(`/agent/${result.agentId}/profile`);
      }

      // 4. Refresh agent list
      get().refreshAgentList();

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
      set({ inputActiveMode: null }, false, n('sendAsAgent/clearMode'));

      return result.agentId!;
    } finally {
      set({ homeInputLoading: false }, false, n('sendAsAgent/end'));
    }
  },

  sendAsGroup: async (message) => {
    set({ homeInputLoading: true }, false, n('sendAsGroup/start'));

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
          orchestratorModel: model,
          orchestratorProvider: provider,
          scene: 'productive',
          systemPrompt: message,
        },
        title: message?.slice(0, 50) || 'New Group',
      });

      // 3. Load groups and refresh
      const groupStore = getChatGroupStoreState();
      await groupStore.loadGroups();

      // 4. Navigate to Group profile page
      const { navigate } = get();
      if (navigate) {
        navigate(`/group/${group.id}/profile`);
      }

      // 5. Update groupAgentBuilder's model config and send initial message
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

      // 6. Clear mode
      set({ inputActiveMode: null }, false, n('sendAsGroup/clearMode'));

      return group.id;
    } finally {
      set({ homeInputLoading: false }, false, n('sendAsGroup/end'));
    }
  },

  sendAsImage: () => {
    // Navigate to /image page
    const { navigate } = get();
    if (navigate) {
      navigate('/image');
    }

    // Clear mode
    set({ inputActiveMode: null }, false, n('sendAsImage'));
  },

  sendAsResearch: async (message) => {
    // TODO: Implement DeepResearch mode
    console.log('sendAsResearch:', message);

    // Clear mode
    set({ inputActiveMode: null }, false, n('sendAsResearch'));
  },

  sendAsWrite: async (message) => {
    set({ homeInputLoading: true }, false, n('sendAsWrite/start'));

    try {
      // 1. Create new Document
      const newDoc = await documentService.createDocument({
        editorData: '',
        title: message?.slice(0, 50) || 'Untitled',
      });

      // 2. Navigate to Page
      const { navigate } = get();
      if (navigate) {
        navigate(`/page/${newDoc.id}`);
      }

      // 3. Send message with document scope context
      const { sendMessage } = useChatStore.getState();
      await sendMessage({
        context: {
          agentId: newDoc.id,
          scope: 'page',
        },
        message,
      });

      // 4. Clear mode
      set({ inputActiveMode: null }, false, n('sendAsWrite/clearMode'));

      return newDoc.id;
    } finally {
      set({ homeInputLoading: false }, false, n('sendAsWrite/end'));
    }
  },

  setInputActiveMode: (mode) => {
    set({ inputActiveMode: mode }, false, n('setInputActiveMode', mode));
  },

  setNavigate: (navigate) => {
    set({ navigate }, false, n('setNavigate'));
  },
});
