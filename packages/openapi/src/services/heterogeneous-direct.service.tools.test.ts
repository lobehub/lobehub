import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  initModelRuntimeFromServerConfig,
  resolveServerDefaultHeterogeneousModel,
} from '@/server/modules/ModelRuntime';

import {
  encodeResponsesStream,
  invokeServerDefaultModel,
  normalizeResponsesRequest,
} from './heterogeneous-direct.service';

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromServerConfig: vi.fn(),
  resolveServerDefaultHeterogeneousModel: vi.fn(),
}));

const protocolStream = (events: Array<{ data: unknown; id?: string; type: string }>) => {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(
          encoder.encode(
            `${event.id ? `id: ${event.id}\n` : ''}event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`,
          ),
        );
      }
      controller.close();
    },
  });
};

const RESPONSES_STREAM_MODEL = 'lobehub/gpt-5.4';

const readText = async (stream: ReadableStream<Uint8Array>) => new Response(stream).text();

const responsesSse = (source: ReadableStream<Uint8Array>) =>
  encodeResponsesStream(source, RESPONSES_STREAM_MODEL);

const parseSseEvents = (output: string) =>
  output
    .split('\n\n')
    .filter(Boolean)
    .map((block) => {
      const lines = block.split('\n');
      const data = lines.find((line) => line.startsWith('data: '))?.slice(6);
      const type = lines.find((line) => line.startsWith('event: '))?.slice(7);
      return { data: data === '[DONE]' ? data : JSON.parse(data || 'null'), type };
    });

describe('heterogeneous direct tool protocols', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it('retains dynamic namespaced tools and custom tool history for Responses', () => {
    const tool = { name: 'exec', type: 'custom', format: { type: 'text' } };
    const tools = [{ name: 'functions', description: '', type: 'namespace', tools: [tool] }];
    const payload = normalizeResponsesRequest(
      {
        input: [
          { type: 'additional_tools', role: 'developer', tools },
          {
            type: 'custom_tool_call',
            call_id: 'call-read',
            name: 'exec',
            namespace: 'functions',
            input: 'read("probe.txt")',
          },
          { type: 'custom_tool_call_output', call_id: 'call-read', output: 'fixture contents' },
          { type: 'message', role: 'user', content: 'Repeat the contents.' },
        ],
        tools,
      },
      'gpt-5.6-sol',
    );

    expect(payload.responsesTools).toEqual(tools);
    expect(payload.messages[0].responsesTools).toEqual(tools);
    expect(payload.messages[1].tool_calls).toEqual([
      {
        id: 'call-read',
        type: 'custom',
        namespace: 'functions',
        function: { name: 'exec', arguments: 'read("probe.txt")' },
      },
    ]);
    expect(payload.messages[2]).toMatchObject({
      role: 'tool',
      tool_call_id: 'call-read',
      content: 'fixture contents',
    });
  });

  it('retains text-block tool outputs instead of stringifying the array', () => {
    const payload = normalizeResponsesRequest(
      {
        input: [
          {
            type: 'custom_tool_call_output',
            call_id: 'custom-1',
            output: [
              { type: 'input_text', text: 'Tool output:\n' },
              { type: 'input_text', text: 'file contents' },
            ],
          },
          {
            type: 'function_call_output',
            call_id: 'function-1',
            output: [{ type: 'input_text', text: 'function contents' }],
          },
        ],
      },
      'gpt-5.6-sol',
    );
    expect(payload.messages.map((message) => message.content)).toEqual([
      'Tool output:\nfile contents',
      'function contents',
    ]);
  });

  it('encodes custom tools with raw input, namespace and stable call IDs', async () => {
    const output = parseSseEvents(
      await readText(
        responsesSse(
          protocolStream([
            {
              type: 'tool_calls',
              data: [
                {
                  index: 0,
                  id: 'call-read',
                  type: 'custom',
                  namespace: 'functions',
                  function: { name: 'exec', arguments: 'read(' },
                },
              ],
            },
            {
              type: 'tool_calls',
              data: [{ index: 0, type: 'custom', function: { arguments: '"probe.txt")' } }],
            },
            { type: 'stop', data: 'stop' },
          ]),
        ),
      ),
    );
    expect(output.find((e) => e.type === 'response.custom_tool_call_input.done')?.data.input).toBe(
      'read("probe.txt")',
    );
    expect(output.find((e) => e.type === 'response.completed')?.data.response.output).toEqual([
      expect.objectContaining({
        type: 'custom_tool_call',
        namespace: 'functions',
        name: 'exec',
        call_id: 'call-read',
        input: 'read("probe.txt")',
      }),
    ]);
  });

  it('adapts root tool combinators before invoking a Claude deployment', async () => {
    const chat = vi.fn().mockResolvedValue(new Response('stream'));
    vi.mocked(resolveServerDefaultHeterogeneousModel).mockResolvedValue({
      model: 'claude-sonnet-4-6',
      provider: 'lobehub',
      supportsAdaptiveThinking: false,
    });
    vi.mocked(initModelRuntimeFromServerConfig).mockResolvedValue({ chat } as any);
    const schema = {
      type: 'object',
      properties: { path: { type: 'string' }, text: { type: 'string' } },
      oneOf: [{ required: ['path'] }, { required: ['text'] }],
    };
    const payload = normalizeResponsesRequest(
      { input: 'Read the file.', tools: [{ type: 'function', name: 'read', parameters: schema }] },
      'lobehub-default',
    );
    await invokeServerDefaultModel({
      agentType: 'grok-build',
      model: 'claude-sonnet-4-6',
      payload,
      signal: new AbortController().signal,
      userId: 'user-1',
    });
    const parameters = chat.mock.calls[0][0].tools[0].function.parameters;
    expect(parameters).not.toHaveProperty('oneOf');
    expect(parameters.if.oneOf).toEqual(schema.oneOf);
    expect(payload.tools?.[0].function.parameters).toEqual(schema);
  });
});
