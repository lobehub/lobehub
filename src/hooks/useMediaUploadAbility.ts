import { useModelSupportAudio } from '@/hooks/useModelSupportAudio';
import { useModelSupportToolUse } from '@/hooks/useModelSupportToolUse';
import { useModelSupportVideo } from '@/hooks/useModelSupportVideo';
import { useModelSupportVision } from '@/hooks/useModelSupportVision';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

export const useMediaUploadAbility = (model: string, provider: string, agentId?: string) => {
  const supportVision = useModelSupportVision(model, provider);
  const supportVideo = useModelSupportVideo(model, provider);
  const supportAudio = useModelSupportAudio(model, provider);
  const supportToolUse = useModelSupportToolUse(model, provider);
  const enableMultimodalUnderstanding = useServerConfigStore(
    serverConfigSelectors.enableMultimodalUnderstanding,
  );
  const multimodalUnderstanding = useServerConfigStore(
    serverConfigSelectors.multimodalUnderstanding,
  );
  const fallbackModel = useAiInfraStore(
    aiModelSelectors.getEnabledModelById(
      multimodalUnderstanding?.model ?? '',
      multimodalUnderstanding?.provider ?? '',
    ),
  );
  const fallbackConfigured = !!(multimodalUnderstanding?.model && multimodalUnderstanding.provider);
  const fallbackSupportAudio = fallbackConfigured && fallbackModel?.abilities?.audio !== false;
  const fallbackSupportVision = fallbackConfigured && fallbackModel?.abilities?.vision !== false;
  const fallbackSupportVideo = fallbackConfigured && fallbackModel?.abilities?.video !== false;
  const canUseMultimodalUnderstanding = enableMultimodalUnderstanding && supportToolUse;

  const heterogeneousAgentType = useAgentStore((s) =>
    agentId
      ? agentByIdSelectors.getAgencyConfigById(agentId)(s)?.heterogeneousProvider?.type
      : undefined,
  );

  // In agent mode (tool calls) or heterogeneous agents (Claude Code / Codex, etc.) the agent
  // can parse any file via scripts/terminal, so the upload should not be gated on the model's
  // own multimodal ability. Mirror the store's `enforceFileTypeWhitelist` bypass in
  // `uploadChatFiles` so the input UI doesn't silently drop audio/video/image the agent could
  // still handle (e.g. .m4a on a non-audio model). See lobehub/lobehub#15770.
  const bypassMediaGate = useAgentStore(
    (s) =>
      !!agentId &&
      (agentByIdSelectors.getAgentEnableModeById(agentId)(s) ||
        agentByIdSelectors.isAgentHeterogeneousById(agentId)(s)),
  );

  if (bypassMediaGate) {
    return {
      canUploadAudio: true,
      // Kimi's one-shot `--prompt` mode has no attachment argument, and ReadMediaFile is only
      // registered for vision-capable local models, which LobeHub cannot determine beforehand.
      canUploadImage: heterogeneousAgentType !== 'kimi-code',
      canUploadVideo: true,
    };
  }

  return {
    canUploadAudio: supportAudio || (canUseMultimodalUnderstanding && fallbackSupportAudio),
    canUploadImage: supportVision || (canUseMultimodalUnderstanding && fallbackSupportVision),
    canUploadVideo: supportVideo || (canUseMultimodalUnderstanding && fallbackSupportVideo),
  };
};
