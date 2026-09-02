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

import type { ExecutionPlan } from '@/helpers/executionTarget';

import type { RuntimeExecutorContext } from '../context';
import { buildToolDiscoveryConfig, log } from '../executorHelpers';
import { resolveRunActiveDeviceId } from '../executors/resolveRunActiveDeviceId';

export interface ServerCallLlmTooling {
  /**
   * The device actually routed for this run, if any (same single-track gate
   * `buildStepToolDelta` uses below). Exposed so callers building prompt
   * template variables can tell whether `runCommand`/`execScript` will
   * execute on a device instead of falling back to the cloud sandbox —
   * `resolved.enabledToolIds.includes('lobe-cloud-sandbox')` alone doesn't
   * cover it, since Skills' sandbox fallback applies whenever no device is
   * routed, independent of whether the dedicated Cloud Sandbox tool is
   * offered.
   */
  activeDeviceId?: string;
  /**
   * The run's resolved execution target (`local`/`device`/`sandbox`/`auto`/
   * `none`), straight from `state.metadata.executionPlan.target`. Exposed
   * alongside `activeDeviceId` because `'auto'` is the one target where a
   * device can be routed (`activeDeviceId` set) while the cloud sandbox is
   * *also* reachable — see `AgentToolsEngine`'s `agentModeRules` gate for
   * `lobe-cloud-sandbox`, which allows it for `'auto'` regardless of routing.
   */
  executionTarget?: ExecutionPlan['target'];
  resolved: ResolvedToolSet;
  resolvedSkills?: ResolvedSkillSet;
  toolDiscoveryConfig?: ToolDiscoveryConfig;
  tools?: ResolvedToolSet['tools'];
}

export const resolveServerCallLlmTooling = (
  ctx: Pick<RuntimeExecutorContext, 'operationId' | 'stepIndex'>,
  state: AgentState,
  allowedToolNames?: string[],
): ServerCallLlmTooling => {
  // Resolve tools via ToolResolver (unified tool injection).
  //
  // Single-track device gate: `buildStepToolDelta` treats activeDeviceId as
  // an independent activation signal (it only dedupes against already-
  // enabled tools), so any id that reaches it WILL inject local-system.
  // `resolveRunActiveDeviceId` swallows the id whenever the plan/policy
  // forbids devices — the same filter the tool executors apply.
  const activeDeviceId = resolveRunActiveDeviceId(state.metadata);
  const executionTarget = (state.metadata?.executionPlan as ExecutionPlan | undefined)?.target;
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
    allowedToolNames,
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
    activeDeviceId,
    executionTarget,
    resolved,
    resolvedSkills,
    toolDiscoveryConfig,
    tools,
  };
};
