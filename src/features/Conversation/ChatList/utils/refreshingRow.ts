import type { UIChatMessage } from '@lobechat/types';

import { collectSteerChains } from '../../store/slices/data/steerChains';

const isAssistantMessage = (m: UIChatMessage) =>
  m.role === 'assistant' || m.role === 'assistantGroup' || m.role === 'supervisor';

/**
 * The rendered row that carries the "fetching latest messages" hint: the one
 * showing the latest assistant reply. The default list folds a steered
 * continuation into its host row; custom renderers keep the list flat, so the
 * continuation renders as its own row there.
 */
export const resolveRefreshingRowId = (
  messages: UIChatMessage[],
  foldsSteerChains: boolean,
): string | undefined => {
  const latestId = messages.findLast(isAssistantMessage)?.id;
  if (!latestId || !foldsSteerChains) return latestId;

  return collectSteerChains(messages).hostOf.get(latestId) ?? latestId;
};
