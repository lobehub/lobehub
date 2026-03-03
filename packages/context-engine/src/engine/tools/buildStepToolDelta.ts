import type { LobeToolManifest, StepToolDelta } from './types';

export interface BuildStepToolDeltaParams {
  /**
   * Currently active device ID (triggers local-system tool injection)
   */
  activeDeviceId?: string;
  /**
   * Force finish flag — strips all tools for pure text output
   */
  forceFinish?: boolean;
  /**
   * The local-system manifest to inject when device is active.
   * Passed in to avoid a hard dependency on @lobechat/builtin-tool-local-system.
   */
  localSystemManifest?: LobeToolManifest;
  /**
   * Tool IDs mentioned via @tool in user messages
   */
  mentionedToolIds?: string[];
  /**
   * The operation-level manifest map (used to check if a tool is already present)
   */
  operationManifestMap: Record<string, LobeToolManifest>;
}

/**
 * Build a declarative StepToolDelta from various activation signals.
 *
 * All step-level tool activation logic should be expressed here,
 * keeping the call_llm executor free of ad-hoc tool injection code.
 */
export function buildStepToolDelta(params: BuildStepToolDeltaParams): StepToolDelta {
  const delta: StepToolDelta = { activatedTools: [] };

  // Device activation → inject local-system tools
  if (
    params.activeDeviceId &&
    params.localSystemManifest &&
    !params.operationManifestMap[params.localSystemManifest.identifier]
  ) {
    delta.activatedTools.push({
      id: params.localSystemManifest.identifier,
      manifest: params.localSystemManifest,
      source: 'device',
    });
  }

  // @tool mentions
  if (params.mentionedToolIds?.length) {
    for (const id of params.mentionedToolIds) {
      if (!params.operationManifestMap[id]) {
        delta.activatedTools.push({ id, source: 'mention' });
      }
    }
  }

  // forceFinish → strip all tools
  if (params.forceFinish) {
    delta.deactivatedToolIds = ['*'];
  }

  return delta;
}
