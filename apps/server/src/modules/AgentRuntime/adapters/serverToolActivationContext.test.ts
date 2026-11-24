// @vitest-environment node
import type { AgentState } from '@lobechat/agent-runtime';
import { LobeActivatorManifest } from '@lobechat/builtin-tool-activator';
import { AgentAccountManifest } from '@lobechat/builtin-tool-agent-account';
import { AgentDocumentsManifest } from '@lobechat/builtin-tool-agent-documents';
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
