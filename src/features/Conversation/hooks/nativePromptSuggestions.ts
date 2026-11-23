import { isDesktop } from '@lobechat/const';
import type { LobeAgentAgencyConfig } from '@lobechat/types';

import { resolveExecutionTarget } from '@/helpers/executionTarget';

/**
 * Whether this agent's runs use the in-process CLI transport, the only one that
 * asks Claude Code for suggestions. Device and sandbox runs go through the
 * gateway and keep server-side extraction. Mirrors `selectRuntimeType`.
 */
export const supportsNativePromptSuggestions = (
  agencyConfig: LobeAgentAgencyConfig | undefined,
  workspaceScoped: boolean,
): boolean =>
  agencyConfig?.heterogeneousProvider?.type === 'claude-code' &&
  resolveExecutionTarget(agencyConfig, {
    clientExecutionAvailable: isDesktop,
    isHetero: true,
    workspaceScoped,
  }) === 'local';
