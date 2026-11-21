import type { ChannelPublicMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { exchangeAgentOf, exchangeLinkOf } from './agentExchange';

const report = (patch: Partial<ChannelPublicMessage> = {}) =>
  ({
    author: { avatar: null, id: 'agt_asker', name: 'Sanjo', type: 'agent' },
    receipt: {
      agent: { agentId: 'agt_answerer', avatar: null, name: 'Xiao C' },
      canOpen: true,
      channelId: 'chn_pair',
      channelTitle: 'Sanjo · Xiao C',
      messageId: 'msg_2',
    },
    via: null,
    ...patch,
  }) as ChannelPublicMessage;

describe('exchangeAgentOf', () => {
  it('names the Agent an Agent report answers', () => {
    expect(exchangeAgentOf(report())?.name).toBe('Xiao C');
  });

  it('applies only to an Agent report that is not a relay receipt', () => {
    expect(
      exchangeAgentOf(report({ author: { avatar: null, id: 'u', name: 'P', type: 'user' } })),
    ).toBeUndefined();
    expect(
      exchangeAgentOf(report({ via: { agentId: 'agt_x', avatar: null, name: 'X' } as never })),
    ).toBeUndefined();
    expect(exchangeAgentOf(report({ receipt: null }))).toBeUndefined();
  });
});

describe('exchangeLinkOf', () => {
  it('links the conversation the answering Agent reported from', () => {
    expect(exchangeLinkOf(report())).toBe('/channels/chn_pair');
  });

  it('offers no link to someone who is not in that conversation', () => {
    const { receipt } = report();
    expect(exchangeLinkOf(report({ receipt: { ...receipt!, canOpen: false } }))).toBeUndefined();
  });

  it('offers no link on a message that is not an Agent report', () => {
    expect(
      exchangeLinkOf(report({ author: { avatar: null, id: 'u', name: 'P', type: 'user' } })),
    ).toBeUndefined();
  });
});
