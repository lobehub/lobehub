import { AuvManifest } from '@lobechat/builtin-tool-auv';
import { BrowserManifest } from '@lobechat/builtin-tool-browser';
import { CloudSandboxManifest } from '@lobechat/builtin-tool-cloud-sandbox';
import { ImageGenerationManifest } from '@lobechat/builtin-tool-image-generation';
import { KnowledgeBaseManifest } from '@lobechat/builtin-tool-knowledge-base';
import { LocalSystemManifest } from '@lobechat/builtin-tool-local-system';
import { MemoryManifest } from '@lobechat/builtin-tool-memory';
import { MessageManifest } from '@lobechat/builtin-tool-message';
import { RemoteDeviceManifest } from '@lobechat/builtin-tool-remote-device';
import { WebBrowsingManifest } from '@lobechat/builtin-tool-web-browsing';
import {
  alwaysOnToolIds,
  chatModeAllowedToolIds,
  defaultToolIds,
  groupSupervisorToolIds,
} from '@lobechat/builtin-tools';
import { executionTargetToRuntimeMode, resolveToolMode } from '@lobechat/types';

import {
  DEVICE_TOOL_IDENTIFIERS,
  type DeviceToolWallParams,
  REMOTE_DEVICE_TOOL_IDENTIFIERS,
} from './deviceTools';
import type { ResolvedToolRules, ToolRuleRequest } from './types';

const enableAll = (ids: readonly string[]) => Object.fromEntries(ids.map((id) => [id, true]));

/** The wall parameters for a run's device facts; no device means no walls. */
export const deviceToolWallParams = (request: ToolRuleRequest): DeviceToolWallParams | undefined =>
  request.deviceAccess
    ? {
        canUseDevice: request.deviceAccess.canUseDevice,
        deviceLocked: request.deviceAccess.deviceLocked,
        disableLocalSystem: request.disableLocalSystem,
        // Only a gateway device can report what it supports.
        supportedDeviceTools: request.device ? (request.device.supportedTools ?? []) : undefined,
      }
    : undefined;

/**
 * Decide which tools a run may enable, which it gets by default, and which
 * must not exist in its manifest pool. The mode (chat / custom / agent) and
 * every per-tool rule live here for both hosts; hosts only assemble the facts
 * and feed the result to the tools engine's enable checker.
 */
export const resolveToolRules = (request: ToolRuleRequest): ResolvedToolRules => {
  const { agent, device, deviceAccess, executionTarget, model } = request;
  const pinnedPluginIds = agent.plugins ?? [];
  const toolMode = resolveToolMode(agent.chatConfig);
  const runtimeMode = executionTargetToRuntimeMode(executionTarget);
  // Device tools only exist for device-capable targets: `none` means no
  // device, and `sandbox` and devices are mutually exclusive.
  const deviceCapable = executionTarget === 'local' || executionTarget === 'device';
  const deviceLocked = deviceAccess?.deviceLocked ?? false;

  const searchMode = agent.chatConfig?.searchMode ?? 'auto';
  const isSearchEnabled = request.useApplicationBuiltinSearchTool ?? searchMode !== 'off';
  const kbEnabled = request.hasEnabledKnowledgeBases ?? false;
  const memoryEnabled = request.memoryEnabled ?? false;
  // Image generation is never auto-injected: the user opts in by pinning the
  // tool, and a model with native image output never gets the fallback.
  const imageGenerationEnabled =
    model.canUseFC &&
    !model.hasImageOutput &&
    pinnedPluginIds.includes(ImageGenerationManifest.identifier);
  // Local tools need a `local` target that can actually reach a machine.
  const localToolsEnabled =
    !request.disableLocalSystem && runtimeMode === 'local' && request.localExecutionReady;

  // Chat mode: a strict outer whitelist. No always-on tools, no runtime
  // injection, no activator — each entry still passes its own gate.
  const chatModeRules = {
    [ImageGenerationManifest.identifier]: imageGenerationEnabled,
    [KnowledgeBaseManifest.identifier]: kbEnabled,
    [MemoryManifest.identifier]: memoryEnabled,
    [WebBrowsingManifest.identifier]: isSearchEnabled,
  };
  // Custom mode: the tool set is EXACTLY the agent's declared plugins, for
  // focused builtin sub-agents that configure themselves precisely.
  const customModeRules = enableAll(pinnedPluginIds);
  const agentModeRules = {
    ...enableAll(request.runtimePluginIds ?? []),
    ...enableAll(pinnedPluginIds),
    ...enableAll(alwaysOnToolIds),
    // System rules may override the user's selection for specific tools.
    // Auto mode lets the model pick the sandbox or the routed device per
    // call, so the dedicated sandbox tool is offered there too.
    [CloudSandboxManifest.identifier]: runtimeMode === 'cloud' || executionTarget === 'auto',
    [KnowledgeBaseManifest.identifier]: kbEnabled,
    [LocalSystemManifest.identifier]: localToolsEnabled,
    // The in-app browser drives the same machine as local-system.
    [BrowserManifest.identifier]: runtimeMode === 'local' && request.localExecutionReady,
    [MemoryManifest.identifier]: memoryEnabled,
    ...(request.isBotConversation && { [MessageManifest.identifier]: true }),
    ...(request.isGroupSupervisor && enableAll(groupSupervisorToolIds)),
    // The device picker: only for device-capable targets behind a gateway,
    // and only while the run still has a device decision to make. The wall
    // below is the authoritative gate; this rule is defense in depth.
    [RemoteDeviceManifest.identifier]: deviceCapable && !!device && !deviceLocked,
    [WebBrowsingManifest.identifier]: isSearchEnabled,
  };

  // Walls follow the policy and the plan, with or without a gateway; the
  // Computer Use opt-in is a gateway device's own report.
  const excludedIdentifiers = new Set(request.disabledPluginIds ?? []);
  if (device && !device.supportedTools?.includes(AuvManifest.identifier))
    excludedIdentifiers.add(AuvManifest.identifier);
  if (deviceAccess) {
    if (!deviceAccess.canUseDevice) {
      for (const identifier of DEVICE_TOOL_IDENTIFIERS) excludedIdentifiers.add(identifier);
    } else if (deviceLocked) {
      for (const identifier of REMOTE_DEVICE_TOOL_IDENTIFIERS) excludedIdentifiers.add(identifier);
    }
  }

  return {
    allowExplicitActivation: toolMode === 'agent',
    defaultToolIds:
      toolMode === 'custom'
        ? [...pinnedPluginIds]
        : toolMode === 'chat'
          ? [...chatModeAllowedToolIds]
          : [...defaultToolIds, ...(request.isGroupSupervisor ? groupSupervisorToolIds : [])],
    deviceCapable,
    deviceLocked,
    excludedIdentifiers,
    rules:
      toolMode === 'custom'
        ? customModeRules
        : toolMode === 'chat'
          ? chatModeRules
          : agentModeRules,
    runtimeMode,
    toolMode,
  };
};
