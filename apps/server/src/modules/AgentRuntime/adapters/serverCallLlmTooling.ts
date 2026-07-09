import type { AgentState } from '@lobechat/agent-runtime';
import { LocalSystemManifest } from '@lobechat/builtin-tool-local-system';
import {
  buildStepSkillDelta,
  buildStepToolDelta,
  type LobeToolManifest,
  type OperationToolSet,
  type ResolvedSkillSet,
  type ResolvedToolSet,
  SkillResolver,
  type ToolDiscoveryConfig,
  ToolResolver,
} from '@lobechat/context-engine';

import type { RuntimeExecutorContext } from '../context';
import { buildToolDiscoveryConfig, log } from '../executorHelpers';
import { resolveRunActiveDeviceId } from '../executors/resolveRunActiveDeviceId';

export interface ServerCallLlmTooling {
  resolved: ResolvedToolSet;
  resolvedSkills?: ResolvedSkillSet;
  toolDiscoveryConfig?: ToolDiscoveryConfig;
  tools?: ResolvedToolSet['tools'];
}

export const resolveServerCallLlmTooling = (
  ctx: Pick<RuntimeExecutorContext, 'operationId' | 'stepIndex'>,
  state: AgentState,
): ServerCallLlmTooling => {
  // Resolve tools via ToolResolver (unified tool injection).
  //
  // Single-track device gate: `buildStepToolDelta` treats activeDeviceId as
  // an independent activation signal (it only dedupes against already-
  // enabled tools), so any id that reaches it WILL inject local-system.
  // `resolveRunActiveDeviceId` swallows the id whenever the plan/policy
  // forbids devices — the same filter the tool executors apply.
  const activeDeviceId = resolveRunActiveDeviceId(state.metadata);
  const operationToolSet: OperationToolSet = state.operationToolSet ?? {
    enabledToolIds: [],
    executorMap: state.toolExecutorMap ?? {},
    manifestMap: state.toolManifestMap ?? {},
    sourceMap: state.toolSourceMap ?? {},
    tools: state.tools ?? [],
  };

  const stepDelta = buildStepToolDelta({
    activeDeviceId,
    enabledToolIds: operationToolSet.enabledToolIds,
    forceFinish: state.forceFinish,
    localSystemManifest: LocalSystemManifest as unknown as LobeToolManifest,
    operationManifestMap: operationToolSet.manifestMap,
  });

  const toolResolver = new ToolResolver();
  const resolved: ResolvedToolSet = toolResolver.resolve(
    operationToolSet,
    stepDelta,
    state.activatedStepTools ?? [],
  );

  const tools = resolved.tools.length > 0 ? resolved.tools : undefined;
  const toolDiscoveryConfig = buildToolDiscoveryConfig(operationToolSet, resolved.enabledToolIds);

  if (stepDelta.activatedTools.length > 0) {
    log(
      `[${ctx.operationId}:${ctx.stepIndex}] ToolResolver injected %d step-level tools: %o`,
      stepDelta.activatedTools.length,
      stepDelta.activatedTools.map((tool) => tool.id),
    );
  }

  // Resolve skills via SkillResolver (unified skill injection).
  const skillResolver = new SkillResolver();
  const stepSkillDelta = buildStepSkillDelta();
  const resolvedSkills = state.metadata?.operationSkillSet
    ? skillResolver.resolve(
        state.metadata.operationSkillSet,
        stepSkillDelta,
        state.activatedStepSkills ?? [],
      )
    : undefined;

  return {
    resolved,
    resolvedSkills,
    toolDiscoveryConfig,
    tools,
  };
};
