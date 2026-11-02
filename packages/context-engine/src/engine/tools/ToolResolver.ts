import type { OnDemandCapabilityExpectation, OnDemandDiscoveryPool } from '@lobechat/types';

import { validateAtomicCapabilityBundle } from '../../onDemand/bundleValidator';
import { ToolNameResolver } from './ToolNameResolver';
import type {
  ActivatedStepTool,
  LobeToolManifest,
  OperationToolSet,
  ResolvedToolSet,
  StepToolDelta,
  ToolExecutor,
  ToolSource,
  UniformTool,
} from './types';
import { generateToolsFromManifest } from './utils';

/**
 * Unified tool resolution engine.
 *
 * Single entry-point that merges operation-level tools with step-level
 * dynamic activations (device, @tool mentions, LLM discovery, etc.)
 * and produces the final `ResolvedToolSet` consumed by `call_llm`.
 */
export class ToolResolver {
  /**
   * Resolve the final tool set for an LLM call.
   *
   * @param operationToolSet  Immutable tools determined at operation creation
   * @param stepDelta         Declarative tool changes for the current step
   * @param accumulatedActivations  Tools activated in previous steps (cumulative)
   */
  resolve(
    operationToolSet: OperationToolSet,
    stepDelta: StepToolDelta,
    accumulatedActivations: ActivatedStepTool[] = [],
    allowedToolNames?: string[],
  ): ResolvedToolSet {
    // Start from operation-level snapshot (shallow copies, with safe defaults)
    const tools: UniformTool[] = [...(operationToolSet.tools ?? [])];
    const sourceMap: Record<string, ToolSource> = { ...operationToolSet.sourceMap };
    const executorMap: Record<string, ToolExecutor> = { ...operationToolSet.executorMap };
    const enabledToolIds: string[] = [...(operationToolSet.enabledToolIds ?? [])];

    // Only include manifests for enabled tools to prevent injecting
    // systemRole for disabled tools (e.g. web-browsing when search is off)
    const manifestMap: Record<string, LobeToolManifest> = {};
    for (const id of enabledToolIds) {
      if (operationToolSet.manifestMap[id]) {
        manifestMap[id] = operationToolSet.manifestMap[id];
      }
    }

    // Apply accumulated step-level activations from previous steps
    for (const activation of accumulatedActivations) {
      this.applyActivation(
        activation,
        operationToolSet.discoveryPool,
        tools,
        manifestMap,
        sourceMap,
        executorMap,
        enabledToolIds,
      );
    }

    // Apply current step delta activations
    for (const activation of stepDelta.activatedTools) {
      this.applyActivation(
        activation,
        operationToolSet.discoveryPool,
        tools,
        manifestMap,
        sourceMap,
        executorMap,
        enabledToolIds,
      );
    }

    const shouldFilterByToolNames = allowedToolNames !== undefined;
    const allowedToolNameSet = new Set(allowedToolNames ?? []);
    const toolNameResolver = new ToolNameResolver();

    let promptManifestMap = manifestMap;
    if (shouldFilterByToolNames) {
      promptManifestMap = {};

      for (const [identifier, manifest] of Object.entries(manifestMap)) {
        const api = manifest.api.filter(({ name }) =>
          allowedToolNameSet.has(toolNameResolver.generate(identifier, name, manifest.type)),
        );

        if (api.length > 0) {
          promptManifestMap[identifier] = {
            ...manifest,
            api,
            ...(api.length < manifest.api.length && { systemRole: undefined }),
          };
        }
      }
    }

    // Handle deactivation (e.g. forceFinish strips all tools)
    if (stepDelta.deactivatedToolIds?.includes('*')) {
      return {
        enabledToolIds: [],
        executorMap,
        manifestMap, // keep manifests for ToolNameResolver
        promptManifestMap: {},
        sourceMap,
        tools: [],
      };
    }

    // Deduplicate tools by function name
    const seen = new Set<string>();
    const dedupedTools: UniformTool[] = [];
    for (const tool of tools) {
      if (shouldFilterByToolNames && !allowedToolNameSet.has(tool.function.name)) {
        continue;
      }
      if (!seen.has(tool.function.name)) {
        seen.add(tool.function.name);
        dedupedTools.push(tool);
      }
    }

    const resolvedEnabledToolIds = shouldFilterByToolNames
      ? enabledToolIds.filter((id) => !!promptManifestMap[id])
      : enabledToolIds;

    return {
      enabledToolIds: [...new Set(resolvedEnabledToolIds)],
      executorMap,
      manifestMap,
      promptManifestMap,
      sourceMap,
      tools: dedupedTools,
    };
  }

  private applyActivation(
    activation: {
      capability?: OnDemandCapabilityExpectation;
      id: string;
      manifest?: LobeToolManifest;
      source?: string;
    },
    discoveryPool: OnDemandDiscoveryPool | undefined,
    tools: UniformTool[],
    manifestMap: Record<string, LobeToolManifest>,
    sourceMap: Record<string, ToolSource>,
    executorMap: Record<string, ToolExecutor>,
    enabledToolIds: string[],
  ): void {
    // Skip if already present
    if (manifestMap[activation.id]) return;

    const resolvedManifest = discoveryPool
      ? this.resolveOnDemandManifest(activation, discoveryPool)
      : activation.manifest;

    if (resolvedManifest) {
      manifestMap[activation.id] = resolvedManifest;
      const newTools = generateToolsFromManifest(resolvedManifest);
      tools.push(...newTools);
      enabledToolIds.push(activation.id);

      // Only set source if not already present — the operation-level sourceMap
      // may already have the correct routing source (e.g., 'lobehubSkill', 'composio')
      // and the activation source ('discovery') should not overwrite it.
      if (activation.source && !sourceMap[activation.id]) {
        sourceMap[activation.id] = this.mapSource(activation.source);
      }

      if (discoveryPool && !executorMap[activation.id]) {
        const bundle = discoveryPool.bundles[activation.id];
        if (bundle) {
          executorMap[activation.id] =
            bundle.execution.environment === 'client' ? 'client' : 'server';
          sourceMap[activation.id] = this.mapCapabilitySource(bundle.sourceRuntime.source);
        }
      }
    }
  }

  /**
   * On-demand activations are executable only through an atomically complete,
   * trusted bundle. Discovery requires the persisted expectation; runtime-owned
   * activation sources (device/mention) may use the operation's card identity.
   * A missing card, missing expectation, or any hash/version drift adds no tool.
   */
  private resolveOnDemandManifest(
    activation: {
      capability?: OnDemandCapabilityExpectation;
      id: string;
      source?: string;
    },
    discoveryPool: OnDemandDiscoveryPool,
  ): LobeToolManifest | undefined {
    const card = discoveryPool.cards.find((item) => item.identifier === activation.id);
    const bundle = discoveryPool.bundles[activation.id];
    if (
      !card ||
      !bundle ||
      card.identifier !== bundle.identifier ||
      card.version !== bundle.version ||
      card.hash !== bundle.hash
    ) {
      return;
    }

    const expectation =
      activation.capability ??
      (activation.source !== 'discovery' && card
        ? {
            hash: card.hash,
            identifier: card.identifier,
            version: card.version,
          }
        : undefined);

    if (!expectation) return;
    if (
      expectation.identifier !== card.identifier ||
      expectation.version !== card.version ||
      expectation.hash !== card.hash
    ) {
      return;
    }

    const validation = validateAtomicCapabilityBundle(bundle, expectation);
    return validation.ok ? (validation.bundle.manifest as LobeToolManifest) : undefined;
  }

  private mapSource(source: string): ToolSource {
    switch (source) {
      case 'device': {
        return 'builtin';
      }
      case 'discovery':
      case 'active_tools':
      case 'mention': {
        return 'builtin';
      }
      default: {
        return 'builtin';
      }
    }
  }

  private mapCapabilitySource(source: string): ToolSource {
    switch (source) {
      case 'composio': {
        return 'composio';
      }
      case 'lobehub-skill': {
        return 'lobehubSkill';
      }
      case 'mcp':
      case 'plugin': {
        return 'mcp';
      }
      default: {
        return 'builtin';
      }
    }
  }
}
