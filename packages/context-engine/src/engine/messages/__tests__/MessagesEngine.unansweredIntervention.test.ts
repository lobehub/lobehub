import { describe, expect, it } from 'vitest';

import type { UIChatMessage } from '@/types/index';

import {
  AWAITING_USER_TOOL_RESULT_CONTENT,
  DISMISSED_TOOL_RESULT_CONTENT,
} from '../../../processors/ToolCall';
import { MessagesEngine } from '../MessagesEngine';
import type { MessagesEngineParams } from '../types';

/**
 * Regression (T-14098): `lobe-creds/requestCredsInput` parks its run on a
 * secure form and persists the tool row as `content: ''` with
 * `pluginIntervention.status: 'pending'`. A new message sent from a surface
 * that cannot show the form (a bot channel, the CLI) starts a new turn while
 * the row is still pending; the server rebuilds the history as an
 * `assistantGroup`, and the model used to read the row as `<empty_content>`.
 */

const now = Date.now();

const historyWithCredsForm = (
  intervention: { status: 'aborted' | 'approved' | 'pending' | 'rejected' },
  resultContent = '',
): UIChatMessage[] =>
  [
    {
      content: 'call the weather API for me',
      createdAt: now,
      id: 'u1',
      role: 'user',
      updatedAt: now,
    },
    {
      children: [
        {
          content: 'I need your weather API key first.',
          id: 'a1',
          tools: [
            {
              apiName: 'requestCredsInput',
              arguments: JSON.stringify({
                fieldNames: ['WEATHER_API_KEY'],
                key: 'weather-api',
                name: 'Weather API',
                type: 'kv-env',
              }),
              id: 'call_creds_1',
              identifier: 'lobe-creds',
              intervention,
              result: { content: resultContent, id: 't1' },
              result_msg_id: 't1',
              type: 'builtin',
            },
          ],
        },
      ],
      content: '',
      createdAt: now,
      id: 'a1',
      role: 'assistantGroup',
      updatedAt: now,
    },
    { content: 'did it work?', createdAt: now, id: 'u2', role: 'user', updatedAt: now },
  ] as unknown as UIChatMessage[];

const createParams = (messages: UIChatMessage[]): MessagesEngineParams => ({
  capabilities: { isCanUseFC: () => true },
  enableSystemDate: false,
  messages,
  model: 'claude-sonnet-5-5',
  provider: 'anthropic',
  systemRole: 'You are a helpful assistant',
});

const toolResultOf = async (messages: UIChatMessage[]) => {
  const result = await new MessagesEngine(createParams(messages)).process();
  return result.messages.find((m: any) => m.role === 'tool' && m.tool_call_id === 'call_creds_1');
};

describe('MessagesEngine — unanswered intervention rows', () => {
  it('tells the model a pending secure form is waiting for the user, not empty', async () => {
    const tool = await toolResultOf(historyWithCredsForm({ status: 'pending' }));

    expect(tool?.content).toBe(AWAITING_USER_TOOL_RESULT_CONTENT);
  });

  it('tells the model a dismissed form produced no result', async () => {
    const aborted = await toolResultOf(historyWithCredsForm({ status: 'aborted' }));
    const rejected = await toolResultOf(historyWithCredsForm({ status: 'rejected' }));

    expect(aborted?.content).toBe(DISMISSED_TOOL_RESULT_CONTENT);
    expect(rejected?.content).toBe(DISMISSED_TOOL_RESULT_CONTENT);
  });

  it('keeps the real result once the form was answered', async () => {
    const saved = 'Credential "Weather API" is saved under key "weather-api".';
    const tool = await toolResultOf(historyWithCredsForm({ status: 'approved' }, saved));

    expect(tool?.content).toBe(saved);
  });
});
