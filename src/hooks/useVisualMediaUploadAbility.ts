import { useModelSupportToolUse } from '@/hooks/useModelSupportToolUse';
import { useModelSupportVideo } from '@/hooks/useModelSupportVideo';
import { useModelSupportVision } from '@/hooks/useModelSupportVision';
import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

export const useVisualMediaUploadAbility = (model: string, provider: string) => {
  const supportVision = useModelSupportVision(model, provider);
  const supportVideo = useModelSupportVideo(model, provider);
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

  return {
    canUploadImage: supportVision || (canUseVisualUnderstanding && fallbackSupportVision),
    canUploadVideo: supportVideo || (canUseVisualUnderstanding && fallbackSupportVideo),
  };
};
