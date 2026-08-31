import useSWR from 'swr';

import { shareKeys } from '@/libs/swr/keys';
import { shareChatService } from '@/services/shareChat';

/**
 * The visitor's own topics on this shared agent (server-scoped by senderId).
 */
export const useVisitorTopics = (shareId: string) =>
  useSWR(shareKeys.visitorTopics(shareId), () => shareChatService.getTopics(shareId), {
    revalidateOnFocus: false,
  });
