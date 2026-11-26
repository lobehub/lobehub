// @vitest-environment node
import { MessagesEngine } from '@lobechat/context-engine';
import { LobeOpenAI, ModelRuntime } from '@lobechat/model-runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fn = (name: string) => ({
  function: { description: name, name, parameters: { properties: {}, type: 'object' } },
  type: 'function' as const,
});
const activator = fn('lobe-activator____activateTools');
afterEach(() => {
  vi.unstubAllEnvs();
});
describe('activation instructions in the outgoing Responses request', () => {
  it.each([
    ['official', undefined, undefined, true],
    ['opt-out', undefined, '0', false],
    ['relay default', 'https://relay.example.com/v1', undefined, false],
    ['relay opt-in', 'https://relay.example.com/v1', 'additional_tools', true],
  ] as const)(
    'places instructions with their schemas for %s',
    async (_name, baseURL, override, anchors) => {
      vi.stubEnv('OPENAI_RESPONSES_TOOL_ANCHORING', override);
      interface RequestBody {
        input: Array<{ content?: string; output?: string; role?: string; type?: string }>;
        tools: Array<{ name?: string }>;
      }
      const requests: RequestBody[] = [];
      const runtime = new ModelRuntime(
        new LobeOpenAI({
          apiKey: 'test',
          baseURL,
          fetch: async (_url: RequestInfo | URL, init?: RequestInit) => {
            requests.push(JSON.parse(String(init?.body)));
            return new Response('data: [DONE]\n\n', {
              headers: { 'content-type': 'text/event-stream' },
            });
          },
        }),
      );
      const model = 'gpt-6.1-sol';
      const instructions = 'Read the sample record before writing.';
      const id = 'sample';
      const dynamicTool = fn('sample____read');
      const { messages } = await new MessagesEngine({
        capabilities: { isCanUseFC: () => true },
        enableSystemDate: false,
        model,
        provider: 'openai',
        systemRole: 'Agent',
        messages: [
          { createdAt: 1, updatedAt: 1, id: 'user', role: 'user', content: 'Read the sample' },
          {
            createdAt: 2,
            updatedAt: 2,
            id: 'assistant',
            role: 'assistant',
            content: '',
            tools: [
              {
                id: 'call',
                identifier: 'lobe-activator',
                apiName: 'activateTools',
                type: 'builtin',
                arguments: '{}',
              },
            ],
          },
          {
            createdAt: 3,
            updatedAt: 3,
            id: 'result',
            role: 'tool',
            content: 'Successfully activated tools.',
            tool_call_id: 'call',
            plugin: {
              arguments: '{}',
              identifier: 'lobe-activator',
              apiName: 'activateTools',
              type: 'builtin',
            },
            pluginState: { activatedTools: [{ identifier: id }] },
          },
        ],
        toolsConfig: {
          anchorActivatedTools: true,
          tools: ['lobe-activator', id],
          manifests: [
            {
              identifier: 'lobe-activator',
              meta: {},
              type: 'builtin',
              api: [{ name: 'activateTools', description: 'Activate', parameters: {} }],
            },
            {
              identifier: id,
              meta: {},
              type: 'builtin',
              systemRole: instructions,
              api: [{ name: 'read', description: 'Read', parameters: {} }],
            },
          ],
        },
      }).process();
      const response = await runtime.chat({
        model,
        messages,
        tools: [activator, dynamicTool],
        stream: true,
      });
      await response.text();
      expect(requests).toHaveLength(1);
      const [request] = requests;
      const system = request.input.find((item) => item.role === 'developer');
      const result = request.input.find((item) => item.type === 'function_call_output');
      expect(system?.content?.includes(instructions)).toBe(!anchors);
      expect(result?.output?.includes(instructions)).toBe(anchors);
      expect(request.tools?.some((t) => t.name === dynamicTool.function.name)).toBe(!anchors);
      expect(request.input.some((item) => item.type === 'additional_tools')).toBe(anchors);
    },
  );
});
