import useSWR from 'swr';

import { shareChatService } from '@/services/shareChat';

export const visitorTopicsKey = (shareId: string) => ['shareChat:topics', shareId];

/** The visitor's own topics on this shared agent, scoped server-side to this share. */
export const useVisitorTopics = (shareId: string) =>
  useSWR(visitorTopicsKey(shareId), () => shareChatService.getTopics(shareId), {
    revalidateOnFocus: false,
  });
