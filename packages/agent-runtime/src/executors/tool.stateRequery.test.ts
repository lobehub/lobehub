import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentRuntimeHost } from '../transport';
import type { AgentInstruction, AgentState } from '../types';
import { callTool, callToolsBatch } from './tool';
import { createState, createToolCall, createToolExecutorFixture } from './tool.testUtils';

/**
 * After a tool call the executors used to re-read the whole conversation into
 * `state.messages`. A host that re-reads it at the next step entry anyway
 * (`rehydratesOnNextStep`, the server) gets the persisted rows patched into the
 * working set instead; every other host keeps the re-query.
 */
describe('tool executors: post-tool state refresh', () => {
  let host: AgentRuntimeHost;
  let query: Mock;
  let runTool: Mock;
  let rehydratesOnNextStep: Mock;
  let toolRows: Map<string, { id: string; parentId: string }>;

  const userRow = { content: 'hi', id: 'user-1', role: 'user' } as AgentState['messages'][number];
  const batchInstruction = (toolIds: string[]): AgentInstruction => ({
    payload: {
      parentMessageId: 'assistant-msg-1',
      toolsCalling: toolIds.map((id) => createToolCall(id)),
    },
    type: 'call_tools_batch',
  });

  beforeEach(() => {
    ({ host, query, runTool, toolRows } = createToolExecutorFixture() as any);
    rehydratesOnNextStep = vi.fn().mockReturnValue(true);
    (host.transports.messages as any).rehydratesOnNextStep = rehydratesOnNextStep;
    let created = 0;
    (host.transports.messages.createToolMessage as Mock).mockImplementation(async () => ({
      id: `tool-msg-${++created}`,
    }));
  });

  describe('callToolsBatch', () => {
    it('patches the batch rows in memory instead of re-reading the conversation', async () => {
      const state = createState({ messages: [userRow] });

      const result = await callToolsBatch(host)(batchInstruction(['call-a', 'call-b']), state);

      expect(rehydratesOnNextStep).toHaveBeenCalledWith(state);
      expect(query).not.toHaveBeenCalled();
      expect(result.newState.messages).toEqual([
        userRow,
        expect.objectContaining({
          content: 'Tool result',
          id: 'tool-msg-1',
          role: 'tool',
          tool_call_id: 'call-a',
        }),
        expect.objectContaining({ id: 'tool-msg-2', role: 'tool', tool_call_id: 'call-b' }),
      ]);
      // The input state is not mutated.
      expect(state.messages).toEqual([userRow]);
    });

    it('replaces a row already in the working set rather than duplicating it', async () => {
      const placeholder = {
        content: '',
        id: 'approved-row',
        role: 'tool',
        tool_call_id: 'call-a',
      } as AgentState['messages'][number];
      const state = createState({ messages: [userRow, placeholder] });
      // The approval pause already wrote the (empty) row for this call.
      toolRows.set('call-a', { id: 'approved-row', parentId: 'assistant-msg-1' });

      const result = await callToolsBatch(host)(
        {
          payload: {
            existingToolMessageIds: { 'call-a': 'approved-row' },
            parentMessageId: 'assistant-msg-1',
            toolsCalling: [createToolCall('call-a')],
          },
          type: 'call_tools_batch',
        } as AgentInstruction,
        state,
      );

      expect(query).not.toHaveBeenCalled();
      expect(result.newState.messages).toHaveLength(2);
      expect(result.newState.messages[1]).toMatchObject({
        content: 'Tool result',
        id: 'approved-row',
      });
    });

    it('keeps the full re-query when the host does not re-read on the next step', async () => {
      rehydratesOnNextStep.mockReturnValue(false);

      const result = await callToolsBatch(host)(batchInstruction(['call-a']), createState());

      expect(query).toHaveBeenCalledTimes(1);
      expect(result.newState.messages).toEqual([
        { content: 'refreshed', id: 'msg-1', role: 'user' },
      ]);
    });

    it('keeps the full re-query for a transport without the capability (client store)', async () => {
      delete (host.transports.messages as any).rehydratesOnNextStep;

      await callToolsBatch(host)(batchInstruction(['call-a']), createState());

      expect(query).toHaveBeenCalledTimes(1);
    });
  });

  describe('callTool', () => {
    const instruction: Extract<AgentInstruction, { type: 'call_tool' }> = {
      payload: { parentMessageId: 'assistant-msg-1', toolCalling: createToolCall() },
      type: 'call_tool',
    };

    it('patches a transport-persisted result in memory when the host re-reads next step', async () => {
      runTool.mockResolvedValueOnce({
        attempts: 1,
        result: { content: 'Persisted result', executionTime: 10, success: true },
        resultPersisted: true,
        toolMessageId: 'persisted-row',
      });

      const result = await callTool(host)(instruction, createState({ messages: [userRow] }));

      expect(query).not.toHaveBeenCalled();
      expect(result.newState.messages).toEqual([
        userRow,
        expect.objectContaining({
          content: 'Persisted result',
          id: 'persisted-row',
          role: 'tool',
          tool_call_id: 'tool-call-1',
        }),
      ]);
    });

    it('still re-reads a transport-persisted result for other hosts', async () => {
      rehydratesOnNextStep.mockReturnValue(false);
      runTool.mockResolvedValueOnce({
        attempts: 1,
        result: { content: 'Persisted result', executionTime: 10, success: true },
        resultPersisted: true,
        toolMessageId: 'persisted-row',
      });

      await callTool(host)(instruction, createState());

      expect(query).toHaveBeenCalledTimes(1);
    });
  });
});
