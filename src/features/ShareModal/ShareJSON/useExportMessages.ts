import type { UIChatMessage } from '@lobechat/types';
import useSWR from 'swr';

import { messageService } from '@/services/message';
import { hydrateProjectedToolMessages } from '@/services/message/hydrateProjectedTools';

/**
 * The messages an export may serialize.
 *
 * The store holds render-facing view models, whose tool bodies live on the
 * server until a card asks for them. An export has no card to expand: it
 * serializes what it is handed, calls the result lossless, and import later
 * treats it as authoritative — so a projected row would silently turn a tool
 * result into an empty string, permanently, on the round trip.
 *
 * Restoring them when this tab opens is the right moment: the user asked for
 * the export, and the preview renders from the same value.
 */
export const useExportMessages = (messages: UIChatMessage[]) => {
  const omittedIds = messages
    .filter((message) => !!message.payloadOmitted)
    .map((message) => message.id);

  const { data, isLoading } = useSWR(
    omittedIds.length > 0 ? ['shareExportMessages', ...omittedIds] : null,
    () => hydrateProjectedToolMessages(messages, messageService.getToolResultPayload),
    { revalidateOnFocus: false },
  );

  return {
    isHydrating: omittedIds.length > 0 && isLoading,
    messages: data ?? messages,
  };
};
