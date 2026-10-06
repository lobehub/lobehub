import { type PortalMoreMenuConfig } from '@/features/Portal/components/PortalMoreMenu/types';
import { useChatStore } from '@/store/chat';
import { useNotebookStore } from '@/store/notebook';

export const useNotebookMoreMenu = (): PortalMoreMenuConfig | undefined => {
  const topicId = useChatStore((s) => s.activeTopicId);
  const refreshDocuments = useNotebookStore((s) => s.refreshDocuments);

  if (!topicId) return;

  // The notebook is the topic's page list — no id, name or route of its own.
  return { refresh: () => refreshDocuments(topicId) };
};
