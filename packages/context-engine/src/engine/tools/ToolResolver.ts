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
      this.applyActivation(activation, tools, manifestMap, sourceMap, enabledToolIds);
    }

    // Apply current step delta activations
    for (const activation of stepDelta.activatedTools) {
      this.applyActivation(activation, tools, manifestMap, sourceMap, enabledToolIds);
    }

    // Handle deactivation (e.g. forceFinish strips all tools)
    if (stepDelta.deactivatedToolIds?.includes('*')) {
      return {
        enabledToolIds: [],
        executorMap,
        manifestMap, // keep manifests for ToolNameResolver
        sourceMap,
        tools: [],
      };
    }

    // Deduplicate tools by function name
    const seen = new Set<string>();
    const dedupedTools: UniformTool[] = [];
    for (const tool of tools) {
      if (!seen.has(tool.function.name)) {
        seen.add(tool.function.name);
        dedupedTools.push(tool);
      }
    }

    return {
      enabledToolIds: [...new Set(enabledToolIds)],
      executorMap,
      manifestMap,
      sourceMap,
      tools: dedupedTools,
    };
  }

  private applyActivation(
    activation: { id: string; manifest?: LobeToolManifest; source?: string },
    tools: UniformTool[],
    manifestMap: Record<string, LobeToolManifest>,
    sourceMap: Record<string, ToolSource>,
    enabledToolIds: string[],
  ): void {
    // Skip if already present
    if (manifestMap[activation.id]) return;

    if (activation.manifest) {
      manifestMap[activation.id] = activation.manifest;
      const newTools = generateToolsFromManifest(activation.manifest);
      tools.push(...newTools);
      enabledToolIds.push(activation.id);

      // Only set source if not already present — the operation-level sourceMap
      // may already have the correct routing source (e.g., 'lobehubSkill', 'klavis')
      // and the activation source ('discovery') should not overwrite it.
      if (activation.source && !sourceMap[activation.id]) {
        sourceMap[activation.id] = this.mapSource(activation.source);
      }
    }
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
}
