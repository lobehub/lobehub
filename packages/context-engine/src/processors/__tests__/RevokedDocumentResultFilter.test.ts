import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import {
  collectDocumentReadIds,
  formatRevokedDocumentResult,
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

const run = async (messages: any[], revokedDocumentIds?: string[]) =>
  new RevokedDocumentResultFilter({ revokedDocumentIds }).process(createContext(messages));

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

describe('collectDocumentReadIds', () => {
  it('collects ids from flat tool rows and nested assistant-group tools', () => {
    const ids = collectDocumentReadIds([
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

    expect(ids.sort()).toEqual(['docs_a', 'docs_b', 'docs_c', 'docs_d', 'docs_e']);
  });
});
