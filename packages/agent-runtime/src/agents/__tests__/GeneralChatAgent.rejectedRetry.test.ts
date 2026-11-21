import { type ChatToolPayload, formatToolRejectionContent } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { type AgentRuntimeContext, type AgentState } from '../../types';
import {
  buildRejectedToolRetryContent,
  REJECTED_TOOL_RETRY_REASON,
} from '../../utils/rejectedToolRetry';
import { GeneralChatAgent } from '../GeneralChatAgent';

const toolKey = 'lobe-local-system/runCommand';

const call = (id: string, identifier = 'lobe-local-system', apiName = 'runCommand') =>
  ({ apiName, arguments: '{"command":"ls"}', id, identifier, type: 'builtin' }) as ChatToolPayload;

const rejectedRow = {
  content: formatToolRejectionContent(),
  plugin: { apiName: 'runCommand', identifier: 'lobe-local-system' },
  pluginIntervention: { status: 'rejected' },
  role: 'tool',
};

const state = (messages: unknown[]) =>
  ({
    messages,
    operationId: 'op',
    status: 'running',
    toolManifestMap: {
      'lobe-web-browsing': {
        api: [{ description: '', humanIntervention: 'never', name: 'search', parameters: {} }],
        identifier: 'lobe-web-browsing',
        meta: {},
        type: 'builtin',
      },
    },
  }) as unknown as AgentState;

const llmResult = (toolsCalling: ChatToolPayload[]) =>
  ({
    payload: { hasToolsCalling: true, parentMessageId: 'assistant-2', result: {}, toolsCalling },
    phase: 'llm_result',
    session: { messageCount: 0, sessionId: 'op', status: 'running', stepCount: 1 },
  }) as unknown as AgentRuntimeContext;

const runner = () =>
  new GeneralChatAgent({
    agentConfig: { maxSteps: 100 },
    modelRuntimeConfig: { model: 'gpt-4o-mini', provider: 'openai' },
    operationId: 'op',
  });

describe('GeneralChatAgent retry of a rejected tool (llm_result phase)', () => {
  it('blocks the retry instead of asking for approval again', async () => {
    const result = await runner().runner(
      llmResult([call('retry')]),
      state([{ role: 'user' }, rejectedRow]),
    );

    expect(result).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          blockedContentByCallId: { retry: buildRejectedToolRetryContent(toolKey) },
          blockedReason: REJECTED_TOOL_RETRY_REASON,
        }),
        type: 'resolve_blocked_tools',
      }),
    ]);
  });

  it('still runs a different tool from the same batch', async () => {
    const result = (await runner().runner(
      llmResult([call('retry'), call('other', 'lobe-web-browsing', 'search')]),
      state([{ role: 'user' }, rejectedRow]),
    )) as any[];

    expect(result.map(({ type }) => type)).toEqual(['resolve_blocked_tools', 'call_tool']);
    expect(result[1].payload.toolCalling.id).toBe('other');
  });

  it('ends the run when the model ignores the block', async () => {
    const blockedRow = { content: buildRejectedToolRetryContent(toolKey), role: 'tool' };
    const result = (await runner().runner(
      llmResult([call('again')]),
      state([{ role: 'user' }, rejectedRow, blockedRow]),
    )) as any[];

    expect(result.map(({ type }) => type)).toEqual(['resolve_blocked_tools', 'finish']);
    expect(result[1].reason).toBe('tool_retry_after_rejection');
  });

  it('keeps the run going when another tool in the batch can still run', async () => {
    const blockedRow = { content: buildRejectedToolRetryContent(toolKey), role: 'tool' };
    const result = (await runner().runner(
      llmResult([call('again'), call('other', 'lobe-web-browsing', 'search')]),
      state([{ role: 'user' }, rejectedRow, blockedRow]),
    )) as any[];

    expect(result.map(({ type }) => type)).toEqual(['resolve_blocked_tools', 'call_tool']);
    expect(result[0].payload.parentNote).toBeUndefined();
  });

  it('asks for approval again after the user replies', async () => {
    const result = await runner().runner(
      llmResult([call('next')]),
      state([{ role: 'user' }, rejectedRow, { role: 'user' }]),
    );

    expect(result).toEqual([expect.objectContaining({ type: 'request_human_approve' })]);
  });
});
