import { describe, expect, it } from 'vitest';

import type { UIChatMessage } from '@/types/index';

import { MessagesEngine } from '../MessagesEngine';
import type { MessagesEngineParams } from '../types';

/**
 * The `compactChannelTurns` engine param gates the ChannelTurnCompactProcessor: only a Channel run
 * (the host sets it for `trigger: channel`) reduces earlier turns to their request.
 */

const CONTEXT = 'earlier public chatter '.repeat(40);

const channelTurn = (request: string, boundary: string) =>
  [
    `<channel_message from="Mia" type="user" boundary="${boundary}">`,
    CONTEXT,
    `</channel_message boundary="${boundary}">`,
    `<channel_request from="Mia" type="user" to="Codex" boundary="${boundary}">`,
    request,
    `</channel_request boundary="${boundary}">`,
  ].join('\n');

const history = (): UIChatMessage[] =>
  [
    { content: channelTurn('Fix the parser', 'aaa111'), id: 'u1', role: 'user' },
    { content: 'Fixed.', id: 'a1', role: 'assistant' },
    { content: channelTurn('Now add tests', 'bbb222'), id: 'u2', role: 'user' },
  ] as unknown as UIChatMessage[];

const createParams = (overrides?: Partial<MessagesEngineParams>): MessagesEngineParams => ({
  capabilities: { isCanUseFC: () => true },
  enableSystemDate: false,
  messages: history(),
  model: 'gpt-4',
  provider: 'openai',
  systemRole: 'You are a helpful assistant',
  ...overrides,
});

const occurrences = (messages: any[]) =>
  messages
    .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
    .join('\n')
    .split(CONTEXT).length - 1;

describe('MessagesEngine — Channel turn compaction switch', () => {
  it('compacts earlier turns of a Channel run, keeping the latest whole', async () => {
    const result = await new MessagesEngine(createParams({ compactChannelTurns: true })).process();

    expect(occurrences(result.messages)).toBe(1);
  });

  it.each([undefined, false])('leaves every other run untouched (%s)', async (flag) => {
    const result = await new MessagesEngine(createParams({ compactChannelTurns: flag })).process();

    expect(occurrences(result.messages)).toBe(2);
  });
});
