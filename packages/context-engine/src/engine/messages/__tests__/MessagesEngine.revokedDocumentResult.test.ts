import { describe, expect, it } from 'vitest';

import type { UIChatMessage } from '@/types/index';

import { MessagesEngine } from '../MessagesEngine';
import type { MessagesEngineParams } from '../types';

/**
 * Regression: a standing-rule agent document read with `readKnowledge` stays in
 * the topic history as a tool message. Once the document is deleted, later
 * turns of the same topic must not send its body to the model any more.
 */

const RULE_BODY = 'STANDING RULE: start every reply with "RULE-ACTIVE".';
const DOC_ID = 'docs_standingRule01';
const now = Date.now();

const historyWithDocumentRead = (fileIds = [DOC_ID]): UIChatMessage[] =>
  [
    { content: 'read our rules doc', createdAt: now, id: 'u1', role: 'user', updatedAt: now },
    {
      content: '',
      createdAt: now,
      id: 'a1',
      role: 'assistant',
      tools: [
        {
          apiName: 'readKnowledge',
          arguments: JSON.stringify({ fileIds }),
          id: 'call_read_1',
          identifier: 'lobe-knowledge-base',
          type: 'builtin',
        },
      ],
      updatedAt: now,
    },
    {
      content: `<file id="${DOC_ID}" name="rules.md">\n${RULE_BODY}\n</file>`,
      createdAt: now,
      id: 't1',
      plugin: {
        apiName: 'readKnowledge',
        arguments: JSON.stringify({ fileIds }),
        identifier: 'lobe-knowledge-base',
        type: 'builtin',
      },
      pluginState: { files: fileIds.map((fileId) => ({ fileId, filename: 'rules.md' })) },
      role: 'tool',
      tool_call_id: 'call_read_1',
      updatedAt: now,
    },
    { content: 'Understood.', createdAt: now, id: 'a2', role: 'assistant', updatedAt: now },
    { content: 'translate: hello', createdAt: now, id: 'u2', role: 'user', updatedAt: now },
  ] as unknown as UIChatMessage[];

const createParams = (overrides?: Partial<MessagesEngineParams>): MessagesEngineParams => ({
  capabilities: { isCanUseFC: () => true },
  enableSystemDate: false,
  messages: historyWithDocumentRead(),
  model: 'gpt-4',
  provider: 'openai',
  systemRole: 'You are a helpful assistant',
  ...overrides,
});

const payloadText = (messages: any[]) =>
  messages
    .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
    .join('\n');

describe('MessagesEngine — revoked document reads', () => {
  it('keeps the document body while the document is live', async () => {
    const result = await new MessagesEngine(createParams()).process();

    expect(payloadText(result.messages)).toContain(RULE_BODY);
  });

  it('drops the body of a deleted document from the same topic history', async () => {
    const result = await new MessagesEngine(
      createParams({ revokedDocumentIds: [DOC_ID] }),
    ).process();

    expect(payloadText(result.messages)).not.toContain(RULE_BODY);
    const tool = result.messages.find((m) => m.role === 'tool') as any;
    expect(tool.content).toContain('<revoked_document_content>');
    expect(tool.tool_call_id).toBe('call_read_1');
    // The assistant tool call it answers is still there.
    const caller = result.messages.find(
      (m: any) => m.role === 'assistant' && m.tool_calls?.length,
    ) as any;
    expect(caller.tool_calls[0].id).toBe('call_read_1');
  });

  it('ignores revoked ids that no historical read referenced', async () => {
    const result = await new MessagesEngine(
      createParams({ revokedDocumentIds: ['docs_other'] }),
    ).process();

    expect(payloadText(result.messages)).toContain(RULE_BODY);
  });
});
