import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import {
  collectDocumentReads,
  formatRevokedDocumentResult,
  formatUnverifiedDocumentResult,
  RevokedDocumentResultFilter,
} from '../RevokedDocumentResultFilter';

const RULE = 'STANDING RULE: prefix every reply with RULE-ACTIVE.';

const createContext = (messages: any[]): PipelineContext => ({
  initialState: { messages: [] },
  isAborted: false,
  messages,
  metadata: {},
});

const readKnowledgeMessage = (fileIds: string[], overrides?: Record<string, unknown>) => ({
  content: `<file id="${fileIds[0]}">${RULE}</file>`,
  id: 'tool-read',
  plugin: {
    apiName: 'readKnowledge',
    arguments: JSON.stringify({ fileIds }),
    identifier: 'lobe-knowledge-base',
  },
  pluginState: { files: fileIds.map((fileId) => ({ fileId, filename: 'rules.md' })) },
  role: 'tool',
  tool_call_id: 'call-read',
  ...overrides,
});

const readDocumentMessage = (id: string) => ({
  content: RULE,
  id: 'tool-doc',
  plugin: {
    apiName: 'readDocument',
    arguments: JSON.stringify({ id }),
    identifier: 'lobe-agent-documents',
  },
  pluginState: { content: RULE, id, title: 'rules.md' },
  role: 'tool',
  tool_call_id: 'call-doc',
});

const run = async (messages: any[], documentIds?: string[]) =>
  new RevokedDocumentResultFilter({
    revokedDocumentReads: documentIds ? [{ documentIds }] : undefined,
  }).process(createContext(messages));

describe('RevokedDocumentResultFilter', () => {
  it('withholds a historical readKnowledge result of a deleted document', async () => {
    const result = await run(
      [
        { content: 'read the rules', id: 'u1', role: 'user' },
        readKnowledgeMessage(['docs_deleted']),
        { content: 'next question', id: 'u2', role: 'user' },
      ],
      ['docs_deleted'],
    );

    const tool = result.messages[1];
    expect(tool.content).toBe(formatRevokedDocumentResult(['docs_deleted']));
    expect(tool.content).not.toContain('RULE-ACTIVE');
    expect(tool.pluginState).toBeUndefined();
    // The tool-call pairing survives so the payload stays valid.
    expect(tool.tool_call_id).toBe('call-read');
    expect(tool.plugin.apiName).toBe('readKnowledge');
    expect(result.metadata.revokedDocumentResultFilter).toEqual({ filteredMessages: 1 });
  });

  it('withholds a readDocument result addressed by binding id', async () => {
    const bindingId = '3f2c4b1a-0000-4000-8000-000000000001';
    const result = await run([readDocumentMessage(bindingId)], [bindingId]);

    expect(result.messages[0].content).not.toContain(RULE);
    expect(result.messages[0].content).toContain(bindingId);
  });

  it('names the still-available documents of a partially revoked read', async () => {
    const result = await run(
      [readKnowledgeMessage(['docs_deleted', 'docs_live'])],
      ['docs_deleted'],
    );

    expect(result.messages[0].content).toBe(
      formatRevokedDocumentResult(['docs_deleted'], ['docs_live']),
    );
  });

  it('keeps live documents, uploads and unrelated tool results unchanged', async () => {
    const messages = [
      readKnowledgeMessage(['docs_live']),
      readKnowledgeMessage(['file_upload']),
      {
        content: RULE,
        id: 'tool-search',
        plugin: { apiName: 'search', arguments: '{}', identifier: 'lobe-web-browsing' },
        role: 'tool',
        tool_call_id: 'call-search',
      },
      { content: 'docs_deleted is mentioned here', id: 'u1', role: 'user' },
    ];
    const result = await run(messages, ['docs_deleted']);

    expect(result.messages).toEqual(messages);
    expect(result.metadata.revokedDocumentResultFilter).toEqual({ filteredMessages: 0 });
  });

  it('is a no-op without revoked ids', async () => {
    const messages = [readKnowledgeMessage(['docs_deleted'])];
    const result = await run(messages);

    expect(result.messages).toEqual(messages);
    expect(result.metadata.revokedDocumentResultFilter).toBeUndefined();
  });

  it('matches ids recorded only in the result state', async () => {
    const result = await run(
      [
        readKnowledgeMessage(['docs_deleted'], {
          plugin: { apiName: 'readKnowledge', identifier: 'lobe-knowledge-base' },
        }),
      ],
      ['docs_deleted'],
    );

    expect(result.messages[0].content).not.toContain(RULE);
  });
});

describe('RevokedDocumentResultFilter — unverified reads', () => {
  it('withholds reads whose binding state could not be checked', async () => {
    const result = await new RevokedDocumentResultFilter({
      revokedDocumentReads: [{ documentIds: [], unverifiedIds: ['docs_rule'] }],
    }).process(createContext([readKnowledgeMessage(['docs_rule'])]));

    expect(result.messages[0].content).toBe(formatUnverifiedDocumentResult(['docs_rule']));
    expect(result.messages[0].content).not.toContain(RULE);
  });
});

describe('RevokedDocumentResultFilter — read route', () => {
  it('keeps a knowledge-base page read through readKnowledge but not through readDocument', async () => {
    const result = await new RevokedDocumentResultFilter({
      revokedDocumentReads: [{ agentDocumentReadIds: ['docs_kb'], documentIds: [] }],
    }).process(createContext([readKnowledgeMessage(['docs_kb']), readDocumentMessage('docs_kb')]));

    expect(result.messages[0].content).toContain(RULE);
    expect(result.messages[1].content).not.toContain(RULE);
    expect(result.messages[1].content).toContain('<revoked_document_content>');
  });
});

describe('RevokedDocumentResultFilter — group topics', () => {
  const groupHistory = () => [
    // Member A (agt_a) read the rules doc in an earlier turn: flat rows.
    {
      agentId: 'agt_a',
      content: '',
      id: 'a-call',
      role: 'assistant',
      tools: [{ apiName: 'readKnowledge', id: 'call-a', identifier: 'lobe-knowledge-base' }],
    },
    {
      ...readKnowledgeMessage(['docs_rule']),
      agentId: 'agt_a',
      id: 'a-tool',
      tool_call_id: 'call-a',
    },
    // Member C (agt_c) read the same id; its own binding is still live. The
    // flattened row carries no agentId, only its caller does.
    {
      agentId: 'agt_c',
      content: '',
      id: 'c-call',
      role: 'assistant',
      tools: [{ apiName: 'readKnowledge', id: 'call-c', identifier: 'lobe-knowledge-base' }],
    },
    { ...readKnowledgeMessage(['docs_rule']), id: 'c-tool', tool_call_id: 'call-c' },
  ];

  it('judges each read against the member that made it', async () => {
    const result = await new RevokedDocumentResultFilter({
      revokedDocumentReads: [
        { documentIds: [] },
        { agentId: 'agt_a', documentIds: ['docs_rule'] },
        { agentId: 'agt_c', documentIds: [] },
      ],
    }).process(createContext(groupHistory()));

    expect(result.messages[1].content).not.toContain(RULE);
    expect(result.messages[3].content).toContain(RULE);
  });

  it("does not apply the current agent's revocations to another member's reads", async () => {
    const result = await new RevokedDocumentResultFilter({
      revokedDocumentReads: [
        { documentIds: ['docs_rule'] },
        { agentId: 'agt_a', documentIds: [] },
        { agentId: 'agt_c', documentIds: [] },
      ],
    }).process(createContext(groupHistory()));

    expect(result.messages[1].content).toContain(RULE);
    expect(result.messages[3].content).toContain(RULE);
  });
});

describe('collectDocumentReads', () => {
  it('records the reading agent from the row, its caller or the enclosing group message', () => {
    const reads = collectDocumentReads([
      {
        agentId: 'agt_a',
        role: 'assistant',
        tools: [{ apiName: 'readKnowledge', id: 'call-a', identifier: 'lobe-knowledge-base' }],
      },
      { ...readKnowledgeMessage(['docs_a']), tool_call_id: 'call-a' },
      { ...readKnowledgeMessage(['docs_b']), agentId: 'agt_b', tool_call_id: 'call-b' },
      {
        agentId: 'agt_g',
        children: [
          {
            tools: [
              {
                apiName: 'readDocument',
                arguments: JSON.stringify({ id: 'docs_g' }),
                identifier: 'lobe-agent-documents',
              },
            ],
          },
        ],
        role: 'assistantGroup',
      },
      readKnowledgeMessage(['docs_none']),
    ]);

    expect(reads).toEqual(
      expect.arrayContaining([
        { agentId: 'agt_a', documentId: 'docs_a' },
        { agentId: 'agt_b', documentId: 'docs_b' },
        { agentId: 'agt_g', documentId: 'docs_g' },
        { agentId: undefined, documentId: 'docs_none' },
      ]),
    );
    expect(reads).toHaveLength(4);
  });

  it('walks agent-council members, plain and assistant-group shaped', () => {
    const readTool = (id: string) => ({
      apiName: 'readKnowledge',
      arguments: JSON.stringify({ fileIds: [id] }),
      id: `call-${id}`,
      identifier: 'lobe-knowledge-base',
      result: { content: RULE, id: `res-${id}` },
    });
    const reads = collectDocumentReads([
      {
        id: 'council',
        members: [
          { agentId: 'agt_m1', role: 'assistant', tools: [readTool('docs_m1')] },
          {
            agentId: 'agt_m2',
            children: [{ tools: [readTool('docs_m2')] }],
            role: 'assistantGroup',
          },
        ],
        role: 'agentCouncil',
      },
    ]);

    expect(reads).toEqual([
      { agentId: 'agt_m1', documentId: 'docs_m1' },
      { agentId: 'agt_m2', documentId: 'docs_m2' },
    ]);
  });

  it('collects ids from flat tool rows and nested assistant-group tools', () => {
    const ids = collectDocumentReads([
      readKnowledgeMessage(['docs_a']),
      readDocumentMessage('docs_b'),
      {
        children: [
          {
            tools: [
              {
                apiName: 'readKnowledge',
                arguments: JSON.stringify({ fileIds: ['docs_c'] }),
                identifier: 'lobe-knowledge-base',
                result: { state: { files: [{ fileId: 'docs_d' }] } },
              },
              {
                apiName: 'search',
                arguments: JSON.stringify({ fileIds: ['docs_ignored'] }),
                identifier: 'lobe-web-browsing',
              },
            ],
          },
        ],
        role: 'assistantGroup',
      },
      { content: 'hi', role: 'user' },
      readKnowledgeMessage(['docs_e'], {
        plugin: {
          apiName: 'readKnowledge',
          arguments: 'not json',
          identifier: 'lobe-knowledge-base',
        },
      }),
    ]);

    expect(ids.map((read) => read.documentId).sort()).toEqual([
      'docs_a',
      'docs_b',
      'docs_c',
      'docs_d',
      'docs_e',
    ]);
  });
});
