import { documentService } from '@/services/document';
import { useChatStore } from '@/store/chat';
import { useGlobalStore } from '@/store/global';
import { type SessionStore } from '@/store/session/store';
import { type StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import { type StarterMode } from './initialState';

const n = setNamespace('homeInput');

type Setter = StoreSetter<SessionStore>;
export const createHomeInputSlice = (set: Setter, get: () => SessionStore, _api?: unknown) =>
  new HomeInputActionImpl(set, get, _api);

export class HomeInputActionImpl {
  readonly #get: () => SessionStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => SessionStore, _api?: unknown) {
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
      // 1. Create new Agent using existing createSession action
      const newAgentId = await this.#get().createSession(
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
      this.#set({ inputActiveMode: null }, false, n('sendAsAgent/clearMode'));

      return newAgentId;
    } finally {
      this.#set({ homeInputLoading: false }, false, n('sendAsAgent/end'));
    }
  };

  sendAsImage = (): void => {
    // Navigate to /image page
    const navigate = useGlobalStore.getState().navigate;
    if (navigate) {
      navigate('/image');
    }

    // Clear mode
    this.#set({ inputActiveMode: null }, false, n('sendAsImage'));
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
