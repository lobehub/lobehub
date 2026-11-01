import type { UIChatMessage } from '@lobechat/types';
import useSWR from 'swr';

import { messageService } from '@/services/message';
import {
  mergeStoredToolPayloads,
  selectProjectedToolIds,
} from '@/services/message/hydrateProjectedTools';

/**
 * The messages an export may serialize.
 *
 * The store holds render-facing view models, whose tool payloads live on the
 * server until a card asks for them. An export has no card to expand: it
 * serializes what it is handed, calls the result lossless, and import later
 * treats it as authoritative — so a projected row would silently turn a tool
 * result into an empty string, permanently, on the round trip.
 *
 * Restoring them when this tab opens is the right moment: the user asked for
 * the export, and the preview renders from the same value.
 *
 * Only the fetched payload MAP is cached. It is keyed by row id, so it stays
 * valid while the conversation grows; merging happens against the current
 * messages, so a new turn arriving with the modal open is exported too.
 */
export const useExportMessages = (messages: UIChatMessage[]) => {
  const omittedIds = selectProjectedToolIds(messages);

  const { data, isLoading } = useSWR(
    omittedIds.length > 0 ? ['shareExportToolPayloads', ...omittedIds] : null,
    ([, ...ids]: string[]) => messageService.getToolResultPayloads(ids),
    { revalidateOnFocus: false },
  );

  const hydrated = mergeStoredToolPayloads(messages, data);

  // A row we could not restore would serialize as an empty result and import
  // would take it as the truth, so the export stays blocked rather than
  // quietly shipping a lossy file.
  return {
    isHydrating: omittedIds.length > 0 && isLoading,
    isIncomplete: !isLoading && hydrated.missing.length > 0,
    messages: hydrated.messages,
  };
};
