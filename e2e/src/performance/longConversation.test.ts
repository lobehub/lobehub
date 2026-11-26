import { describe, expect, it } from 'vitest';

import { buildLongConversationRows, LAST_MESSAGE_MARKER } from './longConversation';

const ids = { agentId: 'agt_perf', topicId: 'tpc_perf', userId: 'user_perf' };

describe('buildLongConversationRows', () => {
  it('builds exactly the requested number of rows as one linear parent chain', () => {
    const { messages } = buildLongConversationRows(ids, 500);

    expect(messages).toHaveLength(500);
    expect(messages[0].parentId).toBeNull();
    for (let i = 1; i < messages.length; i++) {
      expect(messages[i].parentId).toBe(messages[i - 1].id);
      expect(messages[i].createdAt.getTime()).toBeGreaterThan(messages[i - 1].createdAt.getTime());
    }
  });

  it('pairs every tool call with a tool row and its plugin record', () => {
    const { messages, plugins } = buildLongConversationRows(ids, 1000);

    const toolCalls = messages.flatMap((row) => row.tools ?? []);
    const toolRows = messages.filter((row) => row.role === 'tool');

    expect(toolCalls).toHaveLength(100);
    expect(toolRows).toHaveLength(100);
    expect(plugins.map((plugin) => plugin.id)).toEqual(toolRows.map((row) => row.id));
    expect(plugins.map((plugin) => plugin.toolCallId)).toEqual(toolCalls.map((call) => call.id));
    for (const row of toolRows) {
      const parent = messages.find((message) => message.id === row.parentId);
      expect(parent?.tools?.length).toBe(1);
    }
  });

  it('ends on a plain assistant row that alone carries the newest-message marker', () => {
    const { lastMessageId, messages } = buildLongConversationRows(ids, 500);

    const last = messages.at(-1)!;
    expect(last.id).toBe(lastMessageId);
    expect(last.role).toBe('assistant');
    expect(last.tools).toBeNull();
    expect(messages.filter((row) => row.content.includes(LAST_MESSAGE_MARKER))).toEqual([last]);
  });

  it('includes code blocks and images in every cycle', () => {
    const { messages } = buildLongConversationRows(ids, 500);

    expect(messages.filter((row) => row.content.includes('```ts'))).toHaveLength(50);
    expect(messages.filter((row) => row.content.includes('![Dashboard screenshot]'))).toHaveLength(
      50,
    );
  });

  it('rejects counts that would cut a cycle in half', () => {
    expect(() => buildLongConversationRows(ids, 505)).toThrow(/multiple of 10/);
    expect(() => buildLongConversationRows(ids, 0)).toThrow(/multiple of 10/);
  });
});
