import { describe, expect, it } from 'vitest';

import type { UIChatMessage } from '@/types/index';

import type { LobeToolManifest } from '../../tools/types';
import { MessagesEngine } from '../MessagesEngine';
import type { MessagesEngineParams } from '../types';

/**
 * Activating a tool mid-conversation must only append to the request. Anything that
 * changes ahead of the history (the system message here; the top-level tools on the
 * transport side) costs the prompt cache for every token after it.
 */

const CREDS_SYSTEM_ROLE = 'lobe-creds usage: always list before creating.';

const activatorManifest = {
  api: [{ description: 'Activate tools', name: 'activateTools', parameters: {} }],
  identifier: 'lobe-activator',
  meta: { title: 'Activator' },
  systemRole: 'Activate a tool before calling it.',
  type: 'builtin',
} as unknown as LobeToolManifest;

const credsManifest = {
  api: [{ description: 'List credentials', name: 'listCreds', parameters: {} }],
  identifier: 'lobe-creds',
  meta: { title: 'Creds' },
  systemRole: CREDS_SYSTEM_ROLE,
  type: 'builtin',
} as unknown as LobeToolManifest;

const now = 1_700_000_000_000;

const firstTurn = (): UIChatMessage[] =>
  [
    { content: 'help me manage creds', createdAt: now, id: 'u1', role: 'user', updatedAt: now },
  ] as unknown as UIChatMessage[];

const afterActivation = (): UIChatMessage[] =>
  [
    ...firstTurn(),
    {
      content: '',
      createdAt: now,
      id: 'a1',
      role: 'assistant',
      tools: [
        {
          apiName: 'activateTools',
          arguments: '{"identifiers":["lobe-creds"]}',
          id: 'call_activate_1',
          identifier: 'lobe-activator',
          type: 'builtin',
        },
      ],
      updatedAt: now,
    },
    {
      content:
        'Successfully activated tools: lobe-creds.listCreds.\nUsage instructions for the activated items are in the system prompt.',
      createdAt: now,
      id: 't1',
      plugin: {
        apiName: 'activateTools',
        arguments: '{"identifiers":["lobe-creds"]}',
        identifier: 'lobe-activator',
        type: 'builtin',
      },
      pluginState: {
        activatedSkills: [],
        activatedTools: [{ apiCount: 1, identifier: 'lobe-creds', name: 'Creds' }],
      },
      role: 'tool',
      tool_call_id: 'call_activate_1',
      updatedAt: now,
    },
  ] as unknown as UIChatMessage[];

const createParams = (overrides: Partial<MessagesEngineParams>): MessagesEngineParams => ({
  capabilities: { isCanUseFC: () => true },
  enableSystemDate: false,
  messages: [],
  model: 'gpt-6.1-sol',
  provider: 'openai',
  systemRole: 'You are a helpful assistant',
  ...overrides,
});

const run = async (anchorActivatedTools: boolean) => {
  const before = await new MessagesEngine(
    createParams({
      messages: firstTurn(),
      toolsConfig: {
        anchorActivatedTools,
        manifests: [activatorManifest],
        tools: ['lobe-activator'],
      },
    }),
  ).process();
  const after = await new MessagesEngine(
    createParams({
      messages: afterActivation(),
      toolsConfig: {
        anchorActivatedTools,
        manifests: [activatorManifest, credsManifest],
        tools: ['lobe-activator', 'lobe-creds'],
      },
    }),
  ).process();

  return { after: after.messages as any[], before: before.messages as any[] };
};

describe('MessagesEngine tool activation anchoring', () => {
  it('keeps a canonical request and prepares the append-only variant for the transport', async () => {
    const { after, before } = await run(true);
    const result = after.find((message) => message.role === 'tool');
    const plan = result.toolActivationPlan;
    expect(result.content).not.toContain(CREDS_SYSTEM_ROLE);
    expect(after[0].content).toContain(CREDS_SYSTEM_ROLE);
    expect(plan.results).toEqual([
      {
        callId: 'call_activate_1',
        content: expect.stringContaining(CREDS_SYSTEM_ROLE),
        toolNames: ['lobe-creds____listCreds'],
      },
    ]);
    expect(after[0].content.replace(plan.system.original, plan.system.replacement)).toEqual(
      before[0].content,
    );
  });

  it('keeps the system-prompt injection and no annotation when the transport cannot anchor', async () => {
    const { after, before } = await run(false);

    expect(after[0].content).toContain(CREDS_SYSTEM_ROLE);
    expect(after[0].content).not.toBe(before[0].content);

    const result = after.find((message) => message.role === 'tool');
    expect(result.content).not.toContain(CREDS_SYSTEM_ROLE);
    expect(result).not.toHaveProperty('toolActivationPlan');
  });

  it.each(['truncated caller', 'disabled activator'])(
    'retains instructions after a %s',
    async (scenario) => {
      const { messages } = await new MessagesEngine(
        createParams({
          messages: afterActivation(),
          enableHistoryCount: scenario === 'truncated caller',
          historyCount: 1,
          toolsConfig: {
            anchorActivatedTools: true,
            disabledToolIdentifiers: scenario === 'disabled activator' ? ['lobe-activator'] : [],
            manifests: [activatorManifest, credsManifest],
            tools: ['lobe-activator', 'lobe-creds'],
          },
        }),
      ).process();
      expect(messages.some((m) => m.role === 'tool')).toBe(false);
      expect(messages.find((m) => m.role === 'system')?.content).toContain(CREDS_SYSTEM_ROLE);
    },
  );

  it('documents the tool in the system message once its activation left the history', async () => {
    const messages = [
      ...afterActivation(),
      { content: 'thanks', createdAt: now, id: 'a2', role: 'assistant', updatedAt: now },
      { content: 'now list them', createdAt: now, id: 'u2', role: 'user', updatedAt: now },
    ] as unknown as UIChatMessage[];

    const result = await new MessagesEngine(
      createParams({
        enableHistoryCount: true,
        historyCount: 1,
        messages,
        toolsConfig: {
          anchorActivatedTools: true,
          manifests: [activatorManifest, credsManifest],
          tools: ['lobe-activator', 'lobe-creds'],
        },
      }),
    ).process();

    const payload = result.messages as any[];
    expect(payload.some((message) => message.role === 'tool')).toBe(false);
    expect(payload[0].content).toContain(CREDS_SYSTEM_ROLE);
  });
});
