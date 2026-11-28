// @vitest-environment node
import {
  generateToolsFromManifest,
  type LobeToolManifest,
  MessagesEngine,
  replayToolActivationContext,
} from '@lobechat/context-engine';
import type { ContextReplaySnapshot, UIChatMessage } from '@lobechat/types';
import { afterEach, expect, it, vi } from 'vitest';

import { LobeAnthropicAI } from '../../providers/anthropic';
import { LobeOpenAI } from '../../providers/openai';

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: vi.fn().mockResolvedValue([]),
}));
vi.mock('@lobechat/agent-templates', () => ({
  DocumentLoadRule: { ALWAYS: 'always', ONCE: 'once', NEVER: 'never' },
}));
const activator: LobeToolManifest = {
  identifier: 'lobe-activator',
  type: 'builtin',
  api: [
    {
      name: 'activateTools',
      description: 'Activate',
      parameters: { type: 'object', properties: {} },
    },
  ],
  systemRole: 'Activate before calling.',
};
const extra: LobeToolManifest = {
  identifier: 'extra',
  type: 'builtin',
  systemRole: 'Extra usage.',
  api: [{ name: 'run', description: 'Run', parameters: { type: 'object', properties: {} } }],
};
const build = (id: string, messages: UIChatMessage[], manifests: LobeToolManifest[]) =>
  new MessagesEngine({
    messages,
    systemRole: 'Persona',
    model: 'gpt-6.1-sol',
    provider: 'openai',
    enableSystemDate: false,
    capabilities: { isCanUseFC: () => true },
    contextReplay: { invocationId: id },
    toolsConfig: {
      anchorActivatedTools: true,
      tools: manifests.map((m) => m.identifier),
      manifests,
    },
  }).process();
const history = (snapshot: ContextReplaySnapshot): UIChatMessage[] =>
  [
    { id: 'u1', role: 'user', content: 'run extra' },
    {
      id: 'a1',
      role: 'assistant',
      content: '',
      metadata: { contextReplay: snapshot },
      tools: [
        {
          id: 'activation',
          identifier: 'lobe-activator',
          apiName: 'activateTools',
          arguments: '{}',
          type: 'builtin',
        },
      ],
    },
    {
      id: 't1',
      role: 'tool',
      content: 'Activated extra.',
      tool_call_id: 'activation',
      plugin: {
        identifier: 'lobe-activator',
        apiName: 'activateTools',
        arguments: '{}',
        type: 'builtin',
      },
      pluginState: { activatedTools: [{ identifier: 'extra', apiCount: 1, name: 'Extra' }] },
    },
  ] as UIChatMessage[];
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
it('keeps the final Responses request prefix while replay adds an unchanged tool', async () => {
  const first = await build(
    'a1',
    [{ id: 'u1', role: 'user', content: 'run extra' } as UIChatMessage],
    [activator],
  );
  const next = await build('a2', history(first.metadata.contextReplaySnapshot!), [
    activator,
    extra,
  ]);
  const runtime = new LobeOpenAI({ apiKey: 'test' });
  const create = vi.spyOn((runtime as any).client.responses, 'create').mockImplementation(
    async () =>
      new ReadableStream({
        start(c) {
          c.close();
        },
      }) as never,
  );
  for (const [result, manifests] of [
    [first, [activator]],
    [next, [activator, extra]],
  ] as const) {
    await (
      await runtime.chat({
        model: 'gpt-6.1-sol',
        stream: true,
        messages: result.messages,
        tools: manifests.flatMap(generateToolsFromManifest),
      })
    ).text();
  }
  const requests = create.mock.calls.map(([request]) => request as any);
  expect(requests[1].tools).toEqual(requests[0].tools);
  expect(requests[1].input.slice(0, requests[0].input.length)).toEqual(requests[0].input);
  expect(requests[1].input.some((item: any) => item.type === 'additional_tools')).toBe(true);
});
it('keeps changed definitions and missing anchors at the top level', async () => {
  const first = await build(
    'a1',
    [{ id: 'u1', role: 'user', content: 'run extra' } as UIChatMessage],
    [activator],
  );
  const next = await build('a2', history(first.metadata.contextReplaySnapshot!), [
    activator,
    extra,
  ]);
  const later = [
    ...history(first.metadata.contextReplaySnapshot!),
    {
      id: 'a2',
      role: 'assistant',
      content: 'done',
      metadata: { contextReplay: next.metadata.contextReplaySnapshot },
    },
  ] as UIChatMessage[];
  const changed = { ...extra, api: [{ ...extra.api[0], description: 'NEW definition' }] };
  const result = await build('a3', later, [activator, changed]);
  expect(result.messages.some((message) => message.toolActivationPlan?.results.length)).toBe(false);
  const noAnchor = await build(
    'a4',
    later.filter((message) => !['a1', 't1'].includes(message.id)),
    [activator, extra],
  );
  expect(noAnchor.messages.some((message) => message.toolActivationPlan?.results.length)).toBe(
    false,
  );
  const runtime = new LobeOpenAI({ apiKey: 'test' });
  const create = vi.spyOn((runtime as any).client.responses, 'create').mockImplementation(
    async () =>
      new ReadableStream({
        start(controller) {
          controller.close();
        },
      }) as never,
  );
  // Include a transport-side definition change after the engine has prepared an otherwise valid plan.
  for (const messages of [result.messages, noAnchor.messages, next.messages]) {
    await (
      await runtime.chat({
        model: 'gpt-6.1-sol',
        stream: true,
        messages,
        tools: [activator, changed].flatMap(generateToolsFromManifest),
      })
    ).text();
  }
  for (const [request] of create.mock.calls as any[]) {
    expect(request.tools).toHaveLength(2);
    expect(request.input.some((item: any) => item.type === 'additional_tools')).toBe(false);
  }
});

it('projects replay declarations through the capability-gated Anthropic request', async () => {
  vi.stubEnv('ANTHROPIC_ENABLE_INLINE_TOOLS', '1');
  const first = await build(
    'a1',
    [{ id: 'u1', role: 'user', content: 'run extra' } as UIChatMessage],
    [activator],
  );
  const next = await build('a2', history(first.metadata.contextReplaySnapshot!), [
    activator,
    extra,
  ]);
  const runtime = new LobeAnthropicAI({ apiKey: 'test' });
  const create = vi.spyOn((runtime as any).client.messages, 'create').mockImplementation(
    async () =>
      new ReadableStream({
        start(controller) {
          controller.close();
        },
      }) as never,
  );
  for (const [result, manifests] of [
    [first, [activator]],
    [next, [activator, extra]],
  ] as const) {
    await runtime.chat(
      {
        model: 'claude-sonnet-5-5',
        messages: result.messages,
        tools: manifests.flatMap(generateToolsFromManifest),
      },
      { getToolActivationContext: async () => replayToolActivationContext(result.messages) },
    );
  }
  const [before, after] = create.mock.calls.map(([request]) => request as any);
  expect(after.tools).toEqual(before.tools);
  expect(after.system).toEqual(before.system);
  expect(
    after.messages.some(
      (message: any) =>
        message.role === 'system' &&
        message.content.some((block: any) => block.type === 'tool_addition'),
    ),
  ).toBe(true);
});
