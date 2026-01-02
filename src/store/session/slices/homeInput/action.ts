import type { StateCreator } from 'zustand/vanilla';

import { documentService } from '@/services/document';
import { useChatStore } from '@/store/chat';
import { useGlobalStore } from '@/store/global';
import type { SessionStore } from '@/store/session/store';
import { setNamespace } from '@/utils/storeDebug';

import type { StarterMode } from './initialState';

const n = setNamespace('homeInput');

export interface HomeInputAction {
  clearInputMode: () => void;
  sendAsAgent: (message: string) => Promise<string>;
  sendAsImage: () => void;
  sendAsResearch: (message: string) => Promise<void>;
  sendAsWrite: (message: string) => Promise<string>;
  setInputActiveMode: (mode: StarterMode) => void;
}

export const createHomeInputSlice: StateCreator<
  SessionStore,
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
      // 1. Create new Agent using existing createSession action
      const newAgentId = await get().createSession(
        {
          config: { systemRole: message },
          meta: { title: message?.slice(0, 50) || 'New Agent' },
        },
        false, // Don't switch session, we'll navigate manually
      );

      // 2. Navigate to Agent profile page
      const navigate = useGlobalStore.getState().navigate;
      if (navigate) {
        navigate(`/agent/${newAgentId}/profile`);
      }

      // 3. Send initial message with agentId context
      const { sendMessage } = useChatStore.getState();
      await sendMessage({
        context: { agentId: newAgentId, scope: 'agent_builder' },
        message,
      });

      // 4. Clear mode
      set({ inputActiveMode: null }, false, n('sendAsAgent/clearMode'));

      return newAgentId;
    } finally {
      set({ homeInputLoading: false }, false, n('sendAsAgent/end'));
    }
  },

  sendAsImage: () => {
    // Navigate to /image page
    const navigate = useGlobalStore.getState().navigate;
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
      const navigate = useGlobalStore.getState().navigate;
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
});
