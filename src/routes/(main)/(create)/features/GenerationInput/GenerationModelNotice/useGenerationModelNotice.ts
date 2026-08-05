import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';
import { useImageStore } from '@/store/image';
import { imageGenerationConfigSelectors } from '@/store/image/selectors';
import { useVideoStore } from '@/store/video';
import { videoGenerationConfigSelectors } from '@/store/video/selectors';

/**
 * Minimal structural shape the resolver reads — a provider group id plus its child
 * model ids. Decoupled from the full `EnabledProviderWithModels` so callers can pass
 * the store list (structurally assignable) while tests build lightweight fixtures.
 */
interface EnabledModelGroup {
  children: { id: string }[];
  id: string;
}

interface ResolveGenerationModelNoticeParams {
  enabledModelList: EnabledModelGroup[];
  isModelConfigReady: boolean;
  model: string;
  provider: string;
}

/**
 * Pure resolver for the "current model unavailable" notice on the image/video
 * generation pages. Distinguishes the two distinct root causes so the UI can show
 * precise copy (both keys interpolate the provider display name via `{{name}}`):
 *
 * - `notice.providerDisabled`: the provider group is absent from the enabled list
 *   entirely (provider disabled or removed).
 * - `notice.modelRemoved`: the provider group exists but no longer lists the
 *   selected model id among its children.
 *
 * We gate on `isModelConfigReady` (aiProvider runtime state initialized) so we do
 * NOT flash a false warning while the provider runtime config is still loading and
 * the enabled model list is transiently empty. This matters for the default state
 * where the store falls back to `provider=google,
 * model='gemini-3.1-flash-image-preview:image'`: once config is ready and Google is
 * disabled, the notice reads as `providerDisabled` instead of silently generating
 * against a disabled provider (see lobehub/lobehub#17400).
 */
export const resolveGenerationModelNotice = ({
  enabledModelList,
  isModelConfigReady,
  model,
  provider,
}: ResolveGenerationModelNoticeParams) => {
  if (!isModelConfigReady) return;

  // Match the provider group by id first, mirroring `findEnabledChatModel` in the
  // chat input notice.
  const providerGroup = enabledModelList.find((item) => item.id === provider);
  if (!providerGroup) return { key: 'notice.providerDisabled', provider, type: 'warning' } as const;

  const currentModel = providerGroup.children.find((item) => item.id === model);
  if (!currentModel) return { key: 'notice.modelRemoved', provider, type: 'warning' } as const;
};

/** Union of every notice shape `resolveGenerationModelNotice` can return. */
export type GenerationModelNotice = NonNullable<ReturnType<typeof resolveGenerationModelNotice>>;

export interface UseGenerationModelNoticeResult {
  /** Whether the currently selected model is unavailable (notice present). */
  isModelUnavailable: boolean;
  /** The resolved notice, or undefined when the model is available / config not ready. */
  notice: GenerationModelNotice | undefined;
}

export const useImageGenerationModelNotice = (): UseGenerationModelNoticeResult => {
  const model = useImageStore(imageGenerationConfigSelectors.model);
  const provider = useImageStore(imageGenerationConfigSelectors.provider);
  const enabledModelList = useAiInfraStore(aiProviderSelectors.enabledImageModelList);
  const isModelConfigReady = useAiInfraStore((s) =>
    aiProviderSelectors.isInitAiProviderRuntimeState(s),
  );

  const notice = resolveGenerationModelNotice({
    enabledModelList,
    isModelConfigReady,
    model,
    provider,
  });

  return { isModelUnavailable: Boolean(notice), notice };
};

export const useVideoGenerationModelNotice = (): UseGenerationModelNoticeResult => {
  const model = useVideoStore(videoGenerationConfigSelectors.model);
  const provider = useVideoStore(videoGenerationConfigSelectors.provider);
  const enabledModelList = useAiInfraStore(aiProviderSelectors.enabledVideoModelList);
  const isModelConfigReady = useAiInfraStore((s) =>
    aiProviderSelectors.isInitAiProviderRuntimeState(s),
  );

  const notice = resolveGenerationModelNotice({
    enabledModelList,
    isModelConfigReady,
    model,
    provider,
  });

  return { isModelUnavailable: Boolean(notice), notice };
};
