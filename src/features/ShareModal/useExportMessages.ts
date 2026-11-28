import type { UIChatMessage } from '@lobechat/types';
import useSWR from 'swr';

import { messageService } from '@/services/message';
import {
  mergeStoredReasonings,
  mergeStoredToolPayloads,
  selectOmittedReasoningIds,
  selectProjectedToolIds,
} from '@/services/message/hydrateProjectedTools';

/**
 * The messages an export may serialize.
 *
 * The store holds render-facing view models, whose tool payloads and historical
 * reasoning text live on the server until a card asks for them. An export has
 * no card to expand: it serializes what it is handed, calls the result lossless,
 * and import later treats it as authoritative — so a projected row would
 * silently turn a tool result or reasoning block into an empty string,
 * permanently, on the round trip.
 *
 * Restoring them when this tab opens is the right moment: the user asked for
 * the export, and the preview renders from the same value.
 *
 * Only the fetched payload MAPs are cached. They are keyed by row id, so they
 * stay valid while the conversation grows; merging happens against the current
 * messages, so a new turn arriving with the modal open is exported too.
 */
export const useExportMessages = (messages: UIChatMessage[]) => {
  const omittedToolIds = selectProjectedToolIds(messages);
  const omittedReasoningIds = selectOmittedReasoningIds(messages);

  const { data: toolData, isLoading: isLoadingTools } = useSWR(
    omittedToolIds.length > 0 ? ['shareExportToolPayloads', ...omittedToolIds] : null,
    ([, ...ids]: string[]) => messageService.getToolResultPayloads(ids),
    { revalidateOnFocus: false },
  );

  const { data: reasoningData, isLoading: isLoadingReasonings } = useSWR(
    omittedReasoningIds.length > 0 ? ['shareExportReasonings', ...omittedReasoningIds] : null,
    ([, ...ids]: string[]) => messageService.getReasonings(ids),
    { revalidateOnFocus: false },
  );

  const hydratedTools = mergeStoredToolPayloads(messages, toolData);
  const hydratedAll = mergeStoredReasonings(hydratedTools.messages, reasoningData);

  const isHydrating =
    (omittedToolIds.length > 0 && isLoadingTools) ||
    (omittedReasoningIds.length > 0 && isLoadingReasonings);

  // A row we could not restore would serialize as an empty result and import
  // would take it as the truth, so the export stays blocked rather than
  // quietly shipping a lossy file.
  return {
    isHydrating,
    isIncomplete:
      (!isLoadingTools && hydratedTools.missing.length > 0) ||
      (!isLoadingReasonings && hydratedAll.missing.length > 0),
    messages: hydratedAll.messages,
  };
};
