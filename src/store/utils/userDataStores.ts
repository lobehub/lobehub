import { unstable_batchedUpdates } from 'react-dom';

import { useAgentStore } from '@/store/agent';
import { useAgentGroupStore } from '@/store/agentGroup';
import { useChatStore } from '@/store/chat';
import { resetGatewayMuxRegistry } from '@/store/chat/slices/agentRun/actions/transports/gateway/muxRegistry';
import { useDiscoverStore } from '@/store/discover';
import { useDocumentStore } from '@/store/document';
import { useEvalStore } from '@/store/eval';
import { useFileStore } from '@/store/file';
import { useHomeStore } from '@/store/home';
import { useImageStore } from '@/store/image';
import { useKnowledgeBaseStore } from '@/store/library';
import { useMentionStore } from '@/store/mention';
import { useNotebookStore } from '@/store/notebook';
import { usePageStore } from '@/store/page';
import { useQuickNoteStore } from '@/store/quickNote';
import { useSessionStore } from '@/store/session';
import { useTaskStore } from '@/store/task';
import { useToolStore } from '@/store/tool';
import { useUserStore } from '@/store/user';
import { useUserMemoryStore } from '@/store/userMemory';
import type { ResetableStore } from '@/store/utils/resetableStore';
import { useVideoStore } from '@/store/video';

interface ResetableStoreApi {
  getState: () => ResetableStore;
}

const resetableStores: ResetableStoreApi[] = [
  useAgentGroupStore,
  useAgentStore,
  useChatStore,
  useDiscoverStore,
  useDocumentStore,
  useEvalStore,
  useFileStore,
  useHomeStore,
  useImageStore,
  useKnowledgeBaseStore,
  useMentionStore,
  useNotebookStore,
  usePageStore,
  useQuickNoteStore,
  useSessionStore,
  useTaskStore,
  useToolStore,
  useUserMemoryStore,
  useUserStore,
  useVideoStore,
];

export interface StoreActions extends ResetableStore {}

const createStoreActions = (stores: ResetableStoreApi[]): StoreActions => ({
  reset: () => {
    // Drop the per-user gateway socket(s) before the stores they feed are
    // wiped — a new data context must not inherit the old identity's socket.
    resetGatewayMuxRegistry();
    unstable_batchedUpdates(() => {
      for (const store of stores) {
        store.getState().reset();
      }
    });
  },
});

export const stores = createStoreActions(resetableStores);
