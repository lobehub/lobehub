import type { UIChatMessage } from '@lobechat/types';

export interface SteerContinuation {
  groupId: string;
  steerUserId: string;
}

export interface SteerChain {
  continuations: SteerContinuation[];
  hostId: string;
  memberIds: string[];
}

export interface SteerChainIndex {
  byHost: Map<string, SteerChain>;
  hostOf: Map<string, string>;
}

// A plain `assistant` reply (a turn that finished without tool calls) cannot host a
// chain: its row component has no continuation rendering, so a steer after it stays
// a separate row. Fixing that means promoting the reply to `assistantGroup` when it is
// interrupted, not widening this predicate.
const isTurnHost = (message?: UIChatMessage) =>
  message?.role === 'assistantGroup' || message?.role === 'supervisor';

const isTurnTail = (message?: UIChatMessage) =>
  isTurnHost(message) || message?.role === 'assistant';

const isSteerUser = (message?: UIChatMessage) =>
  message?.role === 'user' && !!message.metadata?.steer;

const buildSteerChainIndex = (messages: UIChatMessage[]): SteerChainIndex => {
  const byHost = new Map<string, SteerChain>();
  const hostOf = new Map<string, string>();
  let chain: SteerChain | undefined;

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!;
    const next = messages[index + 1];

    if (chain && isSteerUser(message) && isTurnTail(next)) {
      chain.continuations.push({ groupId: next!.id, steerUserId: message.id });
      chain.memberIds.push(message.id, next!.id);
      hostOf.set(message.id, chain.hostId);
      hostOf.set(next!.id, chain.hostId);
      byHost.set(chain.hostId, chain);
      index += 1;
      continue;
    }

    chain = isTurnHost(message)
      ? { continuations: [], hostId: message.id, memberIds: [message.id] }
      : undefined;
  }

  return { byHost, hostOf };
};

// Streaming swaps the displayMessages array on every chunk; keying on the array
// identity keeps the pass to once per snapshot no matter how many rows read it.
const indexCache = new WeakMap<UIChatMessage[], SteerChainIndex>();

export const collectSteerChains = (messages: UIChatMessage[]): SteerChainIndex => {
  let index = indexCache.get(messages);
  if (!index) {
    index = buildSteerChainIndex(messages);
    indexCache.set(messages, index);
  }
  return index;
};
