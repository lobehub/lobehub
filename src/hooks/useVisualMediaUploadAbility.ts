import { useModelSupportAudio } from '@/hooks/useModelSupportAudio';
import { useModelSupportToolUse } from '@/hooks/useModelSupportToolUse';
import { useModelSupportVideo } from '@/hooks/useModelSupportVideo';
import { useModelSupportVision } from '@/hooks/useModelSupportVision';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

export const useVisualMediaUploadAbility = (model: string, provider: string, agentId?: string) => {
  const supportVision = useModelSupportVision(model, provider);
  const supportVideo = useModelSupportVideo(model, provider);
  const supportAudio = useModelSupportAudio(model, provider);
  const supportToolUse = useModelSupportToolUse(model, provider);
  const enableVisualUnderstanding = useServerConfigStore(
    serverConfigSelectors.enableVisualUnderstanding,
  );
  const visualUnderstanding = useServerConfigStore(serverConfigSelectors.visualUnderstanding);
  const fallbackModel = useAiInfraStore(
    aiModelSelectors.getEnabledModelById(
      visualUnderstanding?.model ?? '',
      visualUnderstanding?.provider ?? '',
    ),
  );
  const fallbackConfigured = !!(visualUnderstanding?.model && visualUnderstanding.provider);
  const fallbackSupportVision = fallbackConfigured && fallbackModel?.abilities?.vision !== false;
  const fallbackSupportVideo = fallbackConfigured && fallbackModel?.abilities?.video !== false;
  const canUseVisualUnderstanding = enableVisualUnderstanding && supportToolUse;

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
    return { canUploadAudio: true, canUploadImage: true, canUploadVideo: true };
  }

  return {
    canUploadAudio: supportAudio,
    canUploadImage: supportVision || (canUseVisualUnderstanding && fallbackSupportVision),
    canUploadVideo: supportVideo || (canUseVisualUnderstanding && fallbackSupportVideo),
  };
};
