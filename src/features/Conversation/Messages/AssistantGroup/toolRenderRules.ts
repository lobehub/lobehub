import {
  ImageGenerationApiName,
  ImageGenerationIdentifier,
} from '@lobechat/builtin-tool-image-generation';
import {
  WebOnboardingApiName,
  WebOnboardingIdentifier,
} from '@lobechat/builtin-tool-web-onboarding';
import type { ChatToolPayloadWithResult } from '@lobechat/types';

interface ToolRenderRuleTarget {
  apiName: string;
  identifier: string;
}

export const shouldRenderToolCall = ({ apiName, identifier }: ToolRenderRuleTarget) => {
  // This call immediately ends onboarding and switches the UI to the completion state.
  if (identifier === WebOnboardingIdentifier && apiName === WebOnboardingApiName.finishOnboarding) {
    return false;
  }

  return true;
};

const hasUploadedImages = (state: unknown): boolean =>
  !!(state as { images?: { url?: string }[] } | undefined)?.images?.some((image) => !!image.url);

const hasGeneratedImage = (state: unknown): boolean =>
  !!(state as { generations?: { asset?: unknown }[] } | undefined)?.generations?.some(
    (generation) => !!generation.asset,
  );

export const isImageBearingTool = (tool: ChatToolPayloadWithResult): boolean => {
  const state = tool.result?.state;
  if (!state) return false;

  if (
    tool.identifier === ImageGenerationIdentifier &&
    tool.apiName === ImageGenerationApiName.generateImage
  )
    return hasGeneratedImage(state);

  return hasUploadedImages(state);
};
