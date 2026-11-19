import { GroupManagementManifest } from '@lobechat/builtin-tool-group-management';
import { describe, expect, it } from 'vitest';

import { createServerAgentToolsEngine } from '../index';
import { type ServerAgentToolsContext } from '../types';

const context: ServerAgentToolsContext = {
  installedPlugins: [],
  isModelSupportToolUse: () => true,
};

const createEngine = (isGroupSupervisor: boolean) =>
  createServerAgentToolsEngine(context, {
    // The agent carries the group tools in its own plugins, e.g. a former
    // supervisor reused as a standalone agent.
    agentConfig: { plugins: [GroupManagementManifest.identifier] },
    isGroupSupervisor,
    model: 'gpt-4',
    provider: 'openai',
  });

const generate = (isGroupSupervisor: boolean) => {
  const engine = createEngine(isGroupSupervisor);
  return {
    enabledToolIds: engine.generateToolsDetailed({
      model: 'gpt-4',
      provider: 'openai',
      toolIds: [GroupManagementManifest.identifier],
    }).enabledToolIds,
    manifests: engine.getEnabledPluginManifests([GroupManagementManifest.identifier]),
  };
};

describe('createServerAgentToolsEngine group supervisor gate', () => {
  it('drops pinned group orchestration tools for a non-supervisor run', () => {
    // Without a group, every call of these tools fails, so they must not be offered.
    const { enabledToolIds, manifests } = generate(false);

    expect(enabledToolIds).not.toContain(GroupManagementManifest.identifier);
    expect(manifests.has(GroupManagementManifest.identifier)).toBe(false);
  });

  it('keeps them for the verified supervisor', () => {
    const { enabledToolIds, manifests } = generate(true);

    expect(enabledToolIds).toContain(GroupManagementManifest.identifier);
    expect(manifests.has(GroupManagementManifest.identifier)).toBe(true);
  });
});
