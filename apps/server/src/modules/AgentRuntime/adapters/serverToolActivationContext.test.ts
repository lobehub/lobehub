// @vitest-environment node
import type { AgentState } from '@lobechat/agent-runtime';
import { LobeActivatorManifest } from '@lobechat/builtin-tool-activator';
import { AgentAccountManifest } from '@lobechat/builtin-tool-agent-account';
import { AgentDocumentsManifest } from '@lobechat/builtin-tool-agent-documents';
import { CloudSandboxManifest } from '@lobechat/builtin-tool-cloud-sandbox';
import { CredsManifest } from '@lobechat/builtin-tool-creds';
import { LocalSystemManifest } from '@lobechat/builtin-tool-local-system';
import { WebBrowsingManifest } from '@lobechat/builtin-tool-web-browsing';
import {
  generateToolsFromManifest,
  type LobeToolManifest,
  ToolResolver,
} from '@lobechat/context-engine';
import type { UIChatMessage } from '@lobechat/types';
import { expect, it } from 'vitest';

import { serverMessagesEngine } from '@/server/modules/Mecha/ContextEngineering';

import { buildToolDiscoveryConfig } from '../executorHelpers';
import { createToolActivationResolver } from './serverToolActivationContext';

it.each([AgentDocumentsManifest, AgentAccountManifest])(
  'keeps the correct system context when activating $identifier',
  async (manifest) => {
    const activator = LobeActivatorManifest as LobeToolManifest;
    const documents = manifest as LobeToolManifest;
    const operationToolSet = {
      enabledToolIds: [activator.identifier],
      manifestMap: { [activator.identifier]: activator, [documents.identifier]: documents },
      sourceMap: {},
      tools: generateToolsFromManifest(activator),
    };
    const activation = {
      activatedAtStep: 1,
      afterToolCallId: 'activate-documents',
      id: documents.identifier,
      manifest: documents,
      source: 'discovery' as const,
    };
    const toolResolver = new ToolResolver();
    const before = toolResolver.resolve(operationToolSet, { activatedTools: [] });
    const after = toolResolver.resolve(operationToolSet, { activatedTools: [] }, [activation]);
    const user = { id: 'user', content: 'read my document', role: 'user' } as UIChatMessage;
    const call = {
      apiName: 'activateTools',
      identifier: activator.identifier,
      arguments: '{}',
      id: activation.afterToolCallId,
      type: 'builtin',
    };
    const input = (resolved: typeof before, messages: UIChatMessage[]) => ({
      messages,
      model: 'claude-sonnet-5-5',
      provider: 'anthropic',
      agentAccountContext: {
        accounts: [],
        inbox: { unreadCount: 1 },
        toolAvailable: resolved.enabledToolIds.includes(AgentAccountManifest.identifier),
      },
      systemRole: 'Keep answers short.',
      toolsConfig: {
        manifests: Object.values(resolved.promptManifestMap),
        tools: resolved.enabledToolIds,
      },
      toolDiscoveryConfig: buildToolDiscoveryConfig(
        operationToolSet,
        operationToolSet.enabledToolIds,
      ),
    });
    const initial = await serverMessagesEngine(input(before, [user]));
    const history = [
      user,
      { id: 'assistant', role: 'assistant', content: '', tools: [call] },
      {
        id: 'result',
        role: 'tool',
        tool_call_id: call.id,
        plugin: call,
        content: 'Activated documents.',
      },
    ] as UIChatMessage[];
    const next = input(after, history);
    const canonical = await serverMessagesEngine(next);
    const state = { activatedStepTools: [activation], operationToolSet } as AgentState;
    const delta = await createToolActivationResolver(state, after, next, canonical.messages)?.();
    if (manifest.identifier === AgentAccountManifest.identifier) {
      expect(initial.messages[0].content).toContain('You cannot read or send mail');
      expect(canonical.messages[0].content).toContain('Read them with the account tool');
      expect(delta).toBeUndefined();
      return;
    }
    expect(delta?.additions).toEqual([
      {
        afterToolCallId: call.id,
        instructions: expect.stringContaining(documents.systemRole!),
        names: generateToolsFromManifest(documents).map((tool) => tool.function.name),
      },
    ]);
    expect(delta?.system).toEqual({
      current: canonical.messages[0].content,
      initial: initial.messages[0].content,
    });
    // Discovery message stays identical across activation — no user-prefix rewrite needed.
    expect(canonical.messages[1]).toEqual(initial.messages[1]);
    expect(canonical.messages[1].content).toContain(documents.identifier);

    // A truncated/pruned result cannot lend its old position to a definition.
    const truncated = await serverMessagesEngine(input(after, [user]));
    expect(await createToolActivationResolver(state, after, next, truncated.messages)?.()).toEqual({
      additions: [],
    });
  },
);

it('preserves SystemDateProvider in both initial and canonical system prompts when activating web-browsing', async () => {
  const activator = LobeActivatorManifest as LobeToolManifest;
  const webBrowsing = WebBrowsingManifest as LobeToolManifest;
  const operationToolSet = {
    enabledToolIds: [activator.identifier],
    manifestMap: { [activator.identifier]: activator, [webBrowsing.identifier]: webBrowsing },
    sourceMap: {},
    tools: generateToolsFromManifest(activator),
  };
  const activation = {
    activatedAtStep: 1,
    afterToolCallId: 'activate-web',
    id: webBrowsing.identifier,
    manifest: webBrowsing,
    source: 'discovery' as const,
  };
  const toolResolver = new ToolResolver();
  const before = toolResolver.resolve(operationToolSet, { activatedTools: [] });
  const after = toolResolver.resolve(operationToolSet, { activatedTools: [] }, [activation]);
  const user = { id: 'user', content: 'check this url', role: 'user' } as UIChatMessage;
  const call = {
    apiName: 'activateTools',
    identifier: activator.identifier,
    arguments: '{}',
    id: activation.afterToolCallId,
    type: 'builtin',
  };
  const input = (resolved: typeof before, messages: UIChatMessage[]) => ({
    messages,
    model: 'claude-sonnet-5-5',
    provider: 'anthropic',
    systemRole: 'Keep answers short.',
    toolsConfig: {
      manifests: Object.values(resolved.promptManifestMap),
      tools: resolved.enabledToolIds,
    },
    toolDiscoveryConfig: buildToolDiscoveryConfig(
      operationToolSet,
      operationToolSet.enabledToolIds,
    ),
    userTimezone: 'Asia/Shanghai',
  });
  const initial = await serverMessagesEngine(input(before, [user]));
  const next = input(after, [
    user,
    { id: 'assistant', role: 'assistant', content: '', tools: [call] },
    {
      id: 'result',
      role: 'tool',
      tool_call_id: call.id,
      plugin: call,
      content: 'Activated web browsing.',
    },
  ] as UIChatMessage[]);
  const canonical = await serverMessagesEngine(next);
  const state = { activatedStepTools: [activation], operationToolSet } as AgentState;
  const delta = await createToolActivationResolver(state, after, next, canonical.messages)?.();

  expect(delta?.system?.initial).toBe(initial.messages[0].content);
  expect(delta?.system?.initial).toContain('Current date:');
  expect(delta?.system?.current).toContain('Current date:');
  expect(canonical.messages[1]).toEqual(initial.messages[1]);
});

it.each([
  {
    additionalVariables: {
      arch: 'arm64',
      platform: 'darwin',
      workingDirectory: '/workspace/demo',
    },
    expectedHydrated: ['/workspace/demo', 'darwin(arm64)'],
    forbiddenRaw: ['{{workingDirectory}}', '{{platform}}', '{{arch}}'],
    manifest: LocalSystemManifest as LobeToolManifest,
  },
  {
    additionalVariables: {},
    expectedHydrated: ['Files from previous sessions may not persist'],
    forbiddenRaw: ['{{sandbox_workspace}}', '{{sandbox_session_files}}'],
    manifest: CloudSandboxManifest as LobeToolManifest,
  },
  {
    additionalVariables: {
      CREDS_LIST: '- github (oauth)',
      creds_sandbox_reachable: 'true',
      sandbox_enabled: 'false',
      username: 'Alice',
    },
    expectedHydrated: ['Current user: Alice', '- github (oauth)', '{{KEY}}_ACCESS_TOKEN'],
    forbiddenRaw: ['{{username}}', '{{CREDS_LIST}}', '{{creds_sandbox_reachable}}'],
    manifest: CredsManifest as LobeToolManifest,
  },
])(
  'hydrates templated placeholders and anchors inline additions for $manifest.identifier',
  async ({ additionalVariables, expectedHydrated, forbiddenRaw, manifest }) => {
    const activator = LobeActivatorManifest as LobeToolManifest;
    const operationToolSet = {
      enabledToolIds: [activator.identifier],
      manifestMap: { [activator.identifier]: activator, [manifest.identifier]: manifest },
      sourceMap: {},
      tools: generateToolsFromManifest(activator),
    };
    const activation = {
      activatedAtStep: 1,
      afterToolCallId: `activate-${manifest.identifier}`,
      id: manifest.identifier,
      manifest,
      source: 'discovery' as const,
    };
    const toolResolver = new ToolResolver();
    const before = toolResolver.resolve(operationToolSet, { activatedTools: [] });
    const after = toolResolver.resolve(operationToolSet, { activatedTools: [] }, [activation]);
    const user = { id: 'user', content: 'run tool', role: 'user' } as UIChatMessage;
    const call = {
      apiName: 'activateTools',
      arguments: '{}',
      id: activation.afterToolCallId,
      identifier: activator.identifier,
      type: 'builtin',
    };
    const input = (resolved: typeof before, messages: UIChatMessage[]) => ({
      additionalVariables,
      messages,
      model: 'claude-sonnet-5-5',
      provider: 'anthropic',
      systemRole: 'Keep answers short.',
      toolDiscoveryConfig: buildToolDiscoveryConfig(
        operationToolSet,
        operationToolSet.enabledToolIds,
      ),
      toolsConfig: {
        manifests: Object.values(resolved.promptManifestMap),
        tools: resolved.enabledToolIds,
      },
      userTimezone: 'UTC',
    });

    const initial = await serverMessagesEngine(input(before, [user]));
    const next = input(after, [
      user,
      { content: '', id: 'assistant', role: 'assistant', tools: [call] },
      {
        content: 'Activated tool.',
        id: 'result',
        plugin: call,
        role: 'tool',
        tool_call_id: call.id,
      },
    ] as UIChatMessage[]);
    const canonical = await serverMessagesEngine(next);
    const state = { activatedStepTools: [activation], operationToolSet } as AgentState;
    const delta = await createToolActivationResolver(state, after, next, canonical.messages)?.();

    expect(delta?.additions).toHaveLength(1);
    expect(delta?.additions[0].afterToolCallId).toBe(call.id);
    expect(delta?.additions[0].names).toEqual(
      generateToolsFromManifest(manifest).map((tool) => tool.function.name),
    );
    for (const expected of expectedHydrated) {
      expect(delta?.additions[0].instructions).toContain(expected);
    }
    for (const raw of forbiddenRaw) {
      expect(delta?.additions[0].instructions).not.toContain(raw);
    }
    expect(delta?.system).toEqual({
      current: canonical.messages[0].content,
      initial: initial.messages[0].content,
    });
  },
);
