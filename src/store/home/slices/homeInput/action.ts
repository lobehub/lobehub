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
          systemPrompt: message,
        },
        title: message?.slice(0, 50) || 'New Group',
      });

      // 3. Load groups and refresh
      const groupStore = getChatGroupStoreState();
      await groupStore.loadGroups();

      // 4. Refresh sidebar agent list
      get().refreshAgentList();

      // 5. Navigate to Group profile page
      const { navigate } = get();
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
      set({ inputActiveMode: null }, false, n('sendAsGroup/clearMode'));

      return group.id;
    } finally {
      set({ homeInputLoading: false }, false, n('sendAsGroup/end'));
    }
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
      const { navigate } = get();
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
