// cspell:ignore tokenx
import { filesPrompts } from '@lobechat/prompts';
import type { ChatFileItem } from '@lobechat/types';
import { estimateTokenCount } from 'tokenx';
import { describe, expect, it, vi } from 'vitest';

import {
  countRequestPayloadTokens,
  type RequestPayloadMessage,
  tryCountRequestPayloadTokens,
} from '../requestPayload';

const tool = {
  function: {
    description: 'Read a file from the workspace',
    name: 'lobe-local-system____readFile____builtin',
    parameters: { properties: { path: { type: 'string' } }, type: 'object' },
  },
  type: 'function',
};

const fileList = [
  {
    content: 'quarterly revenue grew 12% year over year '.repeat(20),
    fileType: 'text/plain',
    id: 'file_1',
    name: 'report.txt',
    size: 1024,
    url: 'https://example.com/report.txt',
  },
] as ChatFileItem[];

describe('countRequestPayloadTokens', () => {
  it('returns zero accounting for an empty request', () => {
    expect(countRequestPayloadTokens({ messages: [] })).toEqual({
      bySource: {
        content: 0,
        fileContext: 0,
        reasoning: 0,
        thoughtSignature: 0,
        toolCallId: 0,
        toolCalls: 0,
        toolDefinition: 0,
      },
      estimator: 'tokenx',
      messageCount: 0,
      system: 0,
      total: 0,
    });
  });

  it('separates system messages from the conversation', () => {
    const systemRole = 'You are a careful analyst. '.repeat(30);
    const result = countRequestPayloadTokens({
      messages: [
        { content: systemRole, role: 'system' },
        { content: 'hello', role: 'user' },
      ],
    });

    expect(result.system).toBe(estimateTokenCount(systemRole));
    expect(result.bySource.content).toBe(estimateTokenCount('hello'));
    expect(result.total).toBe(result.system + result.bySource.content);
  });

  it('counts the tools array as toolDefinition', () => {
    const result = countRequestPayloadTokens({
      messages: [{ content: 'hi', role: 'user' }],
      tools: [tool],
    });

    expect(result.bySource.toolDefinition).toBe(estimateTokenCount(JSON.stringify(tool)));
  });

  it('splits inlined <files_info> blocks out of user content as fileContext', () => {
    const filesContext = filesPrompts({ addUrl: true, fileList, imageList: [] });
    const result = countRequestPayloadTokens({
      messages: [
        {
          content: [{ text: `summarize this\n\n${filesContext}`, type: 'text' }],
          role: 'user',
        },
      ],
    });

    const filesInfo = filesContext.match(/<files_info>[\s\S]*<\/files_info>/)![0];
    expect(result.bySource.fileContext).toBe(estimateTokenCount(filesInfo));
    expect(result.bySource.fileContext).toBeGreaterThan(100);
    // The wrapper around the block and the user's own words stay in content.
    expect(result.bySource.content).toBe(
      estimateTokenCount(`summarize this\n\n${filesContext}`.replace(filesInfo, '')),
    );
  });

  it('counts tool calls, tool results, tool_call_id, reasoning and signatures', () => {
    const toolResult = 'line one of the file\n'.repeat(200);
    const messages: RequestPayloadMessage[] = [
      { content: 'read the file', role: 'user' },
      {
        content: '',
        reasoning: { content: 'I should read the file first.', signature: 'sig'.repeat(40) },
        role: 'assistant',
        tool_calls: [
          {
            function: { arguments: '{"path":"/tmp/a.txt"}', name: tool.function.name },
            id: 'call_1',
            thoughtSignature: 'gemini'.repeat(20),
            type: 'function',
          },
        ],
      },
      { content: toolResult, role: 'tool', tool_call_id: 'call_1' },
    ];

    const result = countRequestPayloadTokens({ messages });

    expect(result.bySource.content).toBe(
      estimateTokenCount('read the file') + estimateTokenCount(toolResult),
    );
    expect(result.bySource.toolCalls).toBe(
      estimateTokenCount('call_1') +
        estimateTokenCount(tool.function.name) +
        estimateTokenCount('{"path":"/tmp/a.txt"}') +
        estimateTokenCount('function'),
    );
    expect(result.bySource.toolCallId).toBe(estimateTokenCount('call_1'));
    expect(result.bySource.reasoning).toBe(estimateTokenCount('I should read the file first.'));
    expect(result.bySource.thoughtSignature).toBe(
      estimateTokenCount('gemini'.repeat(20)) + estimateTokenCount('sig'.repeat(40)),
    );
  });

  it('grows the conversation total when a tool result is appended', () => {
    const before: RequestPayloadMessage[] = [
      { content: 'read the file', role: 'user' },
      {
        content: '',
        role: 'assistant',
        tool_calls: [
          { function: { arguments: '{}', name: 'readFile' }, id: 'call_1', type: 'function' },
        ],
      },
    ];
    const after = [
      ...before,
      { content: 'file body '.repeat(500), role: 'tool', tool_call_id: 'call_1' },
    ];

    const a = countRequestPayloadTokens({ messages: before });
    const b = countRequestPayloadTokens({ messages: after });

    expect(b.bySource.content - a.bySource.content).toBe(
      estimateTokenCount('file body '.repeat(500)),
    );
    expect(b.messageCount).toBe(3);
  });

  it('falls back to reasoning_content and skips media parts', () => {
    const result = countRequestPayloadTokens({
      messages: [
        {
          content: [
            { text: 'what is in this image?', type: 'text' },
            {
              image_url: { url: `data:image/png;base64,${'A'.repeat(10_000)}` },
              type: 'image_url',
            },
          ],
          role: 'user',
        },
        { content: 'a cat', reasoning_content: 'looks like a cat', role: 'assistant' },
      ],
    });

    expect(result.bySource.content).toBe(
      estimateTokenCount('what is in this image?') + estimateTokenCount('a cat'),
    );
    expect(result.bySource.reasoning).toBe(estimateTokenCount('looks like a cat'));
  });
});

describe('tryCountRequestPayloadTokens', () => {
  it('returns the accounting when counting succeeds', () => {
    const params = { messages: [{ content: 'hello', role: 'user' }] };

    expect(tryCountRequestPayloadTokens(params)).toEqual(countRequestPayloadTokens(params));
  });

  it('returns undefined instead of throwing when the payload cannot be counted', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(
      tryCountRequestPayloadTokens({ messages: [{ content: circular, role: 'user' }] }),
    ).toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
