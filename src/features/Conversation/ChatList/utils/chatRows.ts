import type { UIChatMessage } from '@lobechat/types';

import type { SteerContinuation } from '../../store/slices/data/steerChains';
import { collectSteerChains } from '../../store/slices/data/steerChains';

export interface ChatRow {
  continuations?: SteerContinuation[];
  id: string;
}

export const buildChatRows = (messages: UIChatMessage[]): ChatRow[] => {
  const { byHost, hostOf } = collectSteerChains(messages);
  const rows: ChatRow[] = [];

  for (const message of messages) {
    if (hostOf.has(message.id)) continue;
    const chain = byHost.get(message.id);
    rows.push(chain ? { continuations: chain.continuations, id: message.id } : { id: message.id });
  }

  return rows;
};
