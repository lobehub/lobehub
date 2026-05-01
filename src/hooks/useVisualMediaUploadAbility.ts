import { useModelSupportToolUse } from '@/hooks/useModelSupportToolUse';
import { useModelSupportVideo } from '@/hooks/useModelSupportVideo';
import { useModelSupportVision } from '@/hooks/useModelSupportVision';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

export const useVisualMediaUploadAbility = (model: string, provider: string) => {
  const supportVision = useModelSupportVision(model, provider);
  const supportVideo = useModelSupportVideo(model, provider);
  const supportToolUse = useModelSupportToolUse(model, provider);
  const enableVisualUnderstanding = useServerConfigStore(
    serverConfigSelectors.enableVisualUnderstanding,
  );
  const visualUnderstanding = useServerConfigStore(serverConfigSelectors.visualUnderstanding);
  const fallbackSupportVision = useModelSupportVision(
    visualUnderstanding?.model ?? '',
    visualUnderstanding?.provider ?? '',
  );
  const fallbackSupportVideo = useModelSupportVideo(
    visualUnderstanding?.model ?? '',
    visualUnderstanding?.provider ?? '',
  );
  const canUseVisualUnderstanding = enableVisualUnderstanding && supportToolUse;

  return {
    canUploadImage: supportVision || (canUseVisualUnderstanding && fallbackSupportVision),
    canUploadVideo: supportVideo || (canUseVisualUnderstanding && fallbackSupportVideo),
  };
};
