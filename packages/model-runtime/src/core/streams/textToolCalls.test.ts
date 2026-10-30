import { describe, expect, it, vi } from 'vitest';

import type { ChatCompletionTool } from '../../types';
import { OllamaStream } from './ollama';
import { OpenAIStream } from './openai';
import type { StreamProtocolChunk } from './protocol';
import { createTextToolCallTransformer, parseTextToolCallBody } from './textToolCalls';

const tools: ChatCompletionTool[] = [
  {
    function: {
      name: 'lobe-local-system___activateTools',
      parameters: {
        properties: {
          identifiers: { items: { type: 'string' }, type: 'array' },
          reason: { type: 'string' },
        },
        type: 'object',
      },
    },
    type: 'function',
  },
  {
    function: {
      name: 'search',
      parameters: {
        properties: { limit: { type: 'number' }, query: { type: 'string' } },
        type: 'object',
      },
    },
    type: 'function',
  },
];

const XML_CALL = `<tool_call>
<function=lobe-local-system___activateTools>
<parameter=reason>
需要在用户桌面打开本地原型文件做真实渲染验证并截图
</parameter>
<parameter=identifiers>
["lobe-computer-use"]
</parameter>
</function>
</tool_call>`;

const run = async (
  chunks: StreamProtocolChunk[],
  declared: ChatCompletionTool[] | undefined = tools,
) => {
  const source = new ReadableStream<StreamProtocolChunk>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(chunk));
      controller.close();
    },
  });
  const output: StreamProtocolChunk[] = [];
  const reader = source.pipeThrough(createTextToolCallTransformer(declared)).getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    output.push(value);
  }
  return output;
};

const text = (data: string): StreamProtocolChunk => ({ data, id: 'chat_1', type: 'text' });

const textOf = (chunks: StreamProtocolChunk[]) =>
  chunks
    .filter((c) => c.type === 'text')
    .map((c) => c.data)
    .join('');

const toolCallsOf = (chunks: StreamProtocolChunk[]) =>
  chunks.filter((c) => c.type === 'tool_calls').flatMap((c) => c.data);

/** Split a string into chunks of the given size to simulate token streaming. */
const splitEvery = (value: string, size: number) =>
  Array.from({ length: Math.ceil(value.length / size) }, (_, i) =>
    text(value.slice(i * size, (i + 1) * size)),
  );

describe('parseTextToolCallBody', () => {
  const schemas = new Map(tools.map((t) => [t.function.name, t.function.parameters]));

  it('decodes parameters by their declared types', () => {
    const body = `<function=search>
<parameter=query>
123
</parameter>
<parameter=limit>
5
</parameter>
</function>`;

    expect(parseTextToolCallBody(body, schemas)).toEqual({
      arguments: JSON.stringify({ query: '123', limit: 5 }),
      name: 'search',
    });
  });

  it('keeps nullable string parameters as strings', () => {
    const nullable = new Map([
      [
        'assign',
        { properties: { id: { type: ['string', 'null'] }, owner: { type: ['string', 'null'] } } },
      ],
    ]);
    const body = `<function=assign>
<parameter=id>
123
</parameter>
<parameter=owner>
null
</parameter>
</function>`;

    expect(parseTextToolCallBody(body, nullable)?.arguments).toBe(
      JSON.stringify({ id: '123', owner: null }),
    );
  });

  it('rejects undeclared tools', () => {
    expect(parseTextToolCallBody('<function=rm_rf>\n</function>', schemas)).toBeUndefined();
    expect(parseTextToolCallBody('{"name":"rm_rf","arguments":{}}', schemas)).toBeUndefined();
  });
});

describe('createTextToolCallTransformer', () => {
  it('converts a complete Qwen XML tool call into a native tool call', async () => {
    const output = await run([
      text(`我来打开原型文件。\n\n${XML_CALL}`),
      { data: 'stop', id: 'chat_1', type: 'stop' },
    ]);

    expect(textOf(output)).toBe('我来打开原型文件。\n\n');
    const [call] = toolCallsOf(output);
    expect(call).toMatchObject({
      function: { name: 'lobe-local-system___activateTools' },
      index: 0,
      type: 'function',
    });
    expect(JSON.parse(call.function.arguments)).toEqual({
      identifiers: ['lobe-computer-use'],
      reason: '需要在用户桌面打开本地原型文件做真实渲染验证并截图',
    });
    expect(call.id).toMatch(/^lobe-local-system___activateTools_0_/);
    expect(output.at(-1)).toMatchObject({ type: 'stop' });
  });

  it.each([1, 3, 7])('handles a tool call split across chunks of %i chars', async (size) => {
    const output = await run(splitEvery(`先激活工具：\n${XML_CALL}\n完成`, size));

    expect(textOf(output)).toBe('先激活工具：\n\n完成');
    expect(textOf(output)).not.toContain('<');
    expect(toolCallsOf(output)).toHaveLength(1);
  });

  it('converts the JSON variant and numbers multiple calls', async () => {
    const output = await run([
      text('<tool_call>\n{"name": "search", "arguments": {"query": "qwen"}}\n</tool_call>\n'),
      text('<tool_call>{"name": "search", "arguments": "{\\"query\\":\\"vllm\\"}"}</tool_call>'),
    ]);

    const calls = toolCallsOf(output);
    expect(calls.map((c) => [c.index, c.function.name, c.function.arguments])).toEqual([
      [0, 'search', '{"query":"qwen"}'],
      [1, 'search', '{"query":"vllm"}'],
    ]);
    expect(textOf(output)).toBe('\n');
  });

  it.each([1, 5])('keeps a closing tag inside an argument (chunks of %i chars)', async (size) => {
    const json =
      '<tool_call>{"name": "search", "arguments": {"query": "what is </tool_call> \\" {"}}</tool_call>\n';
    const xml =
      '<tool_call>\n<function=search>\n<parameter=query>\nfind </tool_call> tags\n</parameter>\n</function>\n</tool_call>';
    const output = await run(splitEvery(json + xml, size));

    expect(toolCallsOf(output).map((c) => JSON.parse(c.function.arguments).query)).toEqual([
      'what is </tool_call> " {',
      'find </tool_call> tags',
    ]);
    expect(textOf(output)).toBe('\n');
  });

  it('accepts a complete function block whose closing tool_call tag never came', async () => {
    const output = await run([
      text('<tool_call>\n<function=search>\n<parameter=query>a</parameter>\n</function>\n'),
    ]);

    expect(toolCallsOf(output)).toHaveLength(1);
    expect(output.some((c) => c.type === 'error')).toBe(false);
  });

  it('restores an unclosed tool call as text and reports an explicit error', async () => {
    const truncated = '<tool_call>\n<function=search>\n<parameter=query>qw';
    const output = await run([text(truncated), { data: 'length', id: 'chat_1', type: 'stop' }]);

    expect(textOf(output)).toBe(truncated);
    expect(toolCallsOf(output)).toHaveLength(0);
    const error = output.find((c) => c.type === 'error');
    expect(error?.data.message).toContain('unclosed <tool_call>');
    expect(error?.data.type).toBe('ModelTextToolCallError');
    // the error precedes the terminal stop chunk
    expect(output.at(-1)).toMatchObject({ type: 'stop' });
  });

  it.each([
    ['the only parameter', '<parameter=query>foo\n'],
    ['a later parameter', '<parameter=query>a</parameter>\n<parameter=limit>2\n'],
  ])('never runs a call when %s is cut off', async (_, params) => {
    const body = `<tool_call>\n<function=search>\n${params}</function>\n`;

    const unclosed = await run([text(body), { data: 'stop', id: 'chat_1', type: 'stop' }]);
    expect(toolCallsOf(unclosed)).toHaveLength(0);
    expect(textOf(unclosed)).toBe(body);
    expect(unclosed.find((c) => c.type === 'error')?.data.message).toContain('unclosed');

    const closed = await run([text(`${body}</tool_call>`)]);
    expect(toolCallsOf(closed)).toHaveLength(0);
    expect(closed.some((c) => c.type === 'error')).toBe(true);
  });

  it.each([
    ['{"name": "search", "arguments": invalid}'],
    ['{"arguments": {"query": }, "name": "search"}'],
  ])('reports a closed JSON call to a declared tool with broken arguments: %s', async (json) => {
    const output = await run([text(`<tool_call>${json}</tool_call>`)]);

    expect(toolCallsOf(output)).toHaveLength(0);
    expect(output.find((c) => c.type === 'error')?.data.body.reason).toBe('malformed_tool_call');
  });

  it('reports a closed but malformed call to a declared tool', async () => {
    const block =
      '<tool_call>\n<function=search>\n<parameter=query>a</parameter>\nstray\n</function>\n</tool_call>';
    const output = await run([text(block)]);

    expect(textOf(output)).toBe(block);
    expect(output.find((c) => c.type === 'error')?.data.body.reason).toBe('malformed_tool_call');
  });

  describe('false positives', () => {
    it('ignores tool calls inside fenced code blocks', async () => {
      const content = `示例输出：\n\`\`\`xml\n${XML_CALL}\n\`\`\`\n`;
      const output = await run(splitEvery(content, 4));

      expect(textOf(output)).toBe(content);
      expect(toolCallsOf(output)).toHaveLength(0);
    });

    it.each([
      ['a shorter inner fence', '````md\n```\n', '```\n````\n'],
      ['a fence of the other character', '```md\n~~~\n', '~~~\n```\n'],
      ['an inner fence with an info string', '```md\n```xml\n', '```\n'],
      ['a closing fence indented four spaces', '```md\n    ```\n', '```\n'],
      ['a closing fence indented by a tab', '```md\n\t```\n', '```\n'],
    ])('keeps a fence open across %s', async (_, open, close) => {
      const example = `示例：\n${open}${XML_CALL}\n${close}`;
      const output = await run(splitEvery(`${example}${XML_CALL}`, 4));

      expect(textOf(output)).toBe(example);
      // only the call after the closed fence runs
      expect(toolCallsOf(output)).toHaveLength(1);
    });

    it('does not treat a backtick line with backticks in its info string as a fence', async () => {
      const output = await run([text(`\`\`\`js \`x\` 是行内代码\n${XML_CALL}`)]);

      expect(toolCallsOf(output)).toHaveLength(1);
    });

    it.each([
      ['four spaces', '    '],
      ['a tab', '\t'],
    ])('ignores indented code blocks (%s)', async (_, indent) => {
      const block = XML_CALL.split('\n')
        .map((line) => indent + line)
        .join('\n');
      const content = `语法示例：\n\n${block}\n\n完成。`;
      const output = await run(splitEvery(content, 3));

      expect(textOf(output)).toBe(content);
      expect(toolCallsOf(output)).toHaveLength(0);
    });

    it.each([
      ['four spaces', ['    ']],
      ['a tab', ['\t']],
      ['two plus two spaces', ['  ', '  ']],
      ['three plus one spaces', ['   ', ' ']],
    ])('ignores indentation split from the tag across chunks (%s)', async (_, indents) => {
      const chunks = ['语法示例：\n\n', ...indents, `${XML_CALL}\n`];
      const output = await run(chunks.map(text));

      expect(textOf(output)).toBe(chunks.join(''));
      expect(toolCallsOf(output)).toHaveLength(0);
    });

    it('runs a call whose short indentation arrives in its own chunk', async () => {
      const output = await run([text('说明：\n'), text('  '), text(' '), text(XML_CALL)]);

      expect(toolCallsOf(output)).toHaveLength(1);
      expect(textOf(output)).toBe('说明：\n   ');
    });

    it('still runs a call indented by up to three spaces', async () => {
      const output = await run([text(`说明：\n   ${XML_CALL}`)]);

      expect(toolCallsOf(output)).toHaveLength(1);
      expect(textOf(output)).toBe('说明：\n   ');
    });

    it('ignores the tag in the middle of a line', async () => {
      const content =
        '模型会输出 `<tool_call>{"name": "search", "arguments": {}}</tool_call>` 这种格式';
      const output = await run([text(content)]);

      expect(textOf(output)).toBe(content);
      expect(toolCallsOf(output)).toHaveLength(0);
    });

    it('keeps blocks that name an undeclared tool or are not a tool call', async () => {
      const content =
        '<tool_call>\n<function=unknown_tool>\n</function>\n</tool_call>\n<tool_call>随便聊聊</tool_call>';
      const output = await run([text(content)]);

      expect(textOf(output)).toBe(content);
      expect(toolCallsOf(output)).toHaveLength(0);
      expect(output.some((c) => c.type === 'error')).toBe(false);
    });

    it('releases an unrelated unclosed tag without an error', async () => {
      const output = await run([text('<tool_call> 是 Qwen 的标签')]);

      expect(textOf(output)).toBe('<tool_call> 是 Qwen 的标签');
      expect(output.some((c) => c.type === 'error')).toBe(false);
    });

    it('passes everything through when the request declared no tools', async () => {
      const chunks = [text(XML_CALL)];
      expect(await run(chunks, [])).toEqual(chunks);
    });

    it('stays off once the provider returns native tool calls', async () => {
      const native: StreamProtocolChunk = {
        data: [
          {
            function: { arguments: '{}', name: 'search' },
            id: 'call_1',
            index: 0,
            type: 'function',
          },
        ],
        id: 'chat_1',
        type: 'tool_calls',
      };
      const output = await run([text('<tool_'), native, text(`\n${XML_CALL}`)]);

      expect(textOf(output)).toBe(`<tool_\n${XML_CALL}`);
      expect(toolCallsOf(output)).toEqual(native.data);
    });

    it('shifts native tool call indexes past converted calls', async () => {
      const native: StreamProtocolChunk = {
        data: [{ function: { arguments: '{"q', name: 'search' }, id: 'call_1', index: 0 }],
        id: 'chat_1',
        type: 'tool_calls',
      };
      const delta: StreamProtocolChunk = {
        data: [{ function: { arguments: '":1}' }, index: 0 }],
        id: 'chat_1',
        type: 'tool_calls',
      };
      const output = await run([text(XML_CALL), native, delta]);

      expect(toolCallsOf(output).map((c) => c.index)).toEqual([0, 1, 1]);
    });
  });
});

describe('chunk boundary invariance', () => {
  const indented = (indent: string) =>
    XML_CALL.split('\n')
      .map((line) => indent + line)
      .join('\n');
  const corpus = [
    `说明。\n\n${XML_CALL}\n结束`,
    `示例：\n\`\`\`\`md\n\`\`\`\n${XML_CALL}\n\`\`\`\n\`\`\`\`\n${XML_CALL}`,
    `示例：\n\`\`\`md\n    \`\`\`\n\t~~~\n${XML_CALL}\n\`\`\`\n`,
    `示例：\n\n${indented('    ')}\n\n${indented('\t')}\n\n   ${XML_CALL}`,
    '<tool_call>{"name": "search", "arguments": {"query": "a </tool_call> b"}}</tool_call>\n',
    '行内 <tool_call>{"name": "search", "arguments": {}}</tool_call> 不算\n<tool_call> 普通文字',
    '<tool_call>\n<function=search>\n<parameter=query>cut\n</function>\n</tool_call>',
  ];

  const summarize = (chunks: StreamProtocolChunk[]) => ({
    calls: toolCallsOf(chunks).map((c) => [c.function.name, c.function.arguments]),
    errors: chunks.filter((c) => c.type === 'error').map((c) => c.data.body.reason),
    text: textOf(chunks),
  });

  it.each(corpus.map((content, i) => [i, content]))(
    'gives the same result for every chunk size (case %i)',
    async (_, content) => {
      const expected = summarize(await run([text(content)]));
      for (let size = 1; size <= 8; size++) {
        expect(summarize(await run(splitEvery(content, size)))).toEqual(expected);
      }
    },
  );
});

describe('stream integration', () => {
  const openAIChunk = (content: string, finish_reason: string | null = null) => ({
    choices: [{ delta: { content }, finish_reason, index: 0 }],
    created: 1,
    id: 'chatcmpl-1',
    model: 'qwen3-coder-flash',
    object: 'chat.completion.chunk',
  });

  it('OpenAIStream reports text tool calls through onToolsCalling', async () => {
    const source = new ReadableStream({
      start(controller) {
        [
          ...splitEvery(`好的。\n${XML_CALL}`, 5).map((c) => openAIChunk(c.data)),
          openAIChunk('', 'stop'),
        ].forEach((chunk) => controller.enqueue(chunk));
        controller.close();
      },
    });
    const onCompletion = vi.fn();

    const reader = OpenAIStream(source, {
      callbacks: { onCompletion },
      payload: { textToolCallTools: tools },
    }).getReader();
    let sse = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      sse += new TextDecoder().decode(value);
    }

    expect(sse).not.toContain('<function=');
    const data = onCompletion.mock.calls[0][0];
    expect(data.text).toBe('好的。\n');
    expect(data.toolsCalling).toHaveLength(1);
    expect(data.toolsCalling[0].function.name).toBe('lobe-local-system___activateTools');
  });

  it('OllamaStream converts text tool calls when tools are declared', async () => {
    const source = new ReadableStream({
      start(controller) {
        controller.enqueue({ done: false, message: { content: XML_CALL, role: 'assistant' } });
        controller.enqueue({ done: true, message: { content: '', role: 'assistant' } });
        controller.close();
      },
    });
    const onCompletion = vi.fn();

    const reader = OllamaStream(source as any, { onCompletion }, { tools }).getReader();
    while (!(await reader.read()).done);

    const data = onCompletion.mock.calls[0][0];
    expect(data.text).toBe('');
    expect(data.toolsCalling[0].function.name).toBe('lobe-local-system___activateTools');
  });
});
