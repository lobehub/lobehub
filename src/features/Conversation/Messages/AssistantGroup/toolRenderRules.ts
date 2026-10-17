import {
  ImageGenerationApiName,
  ImageGenerationIdentifier,
} from '@lobechat/builtin-tool-image-generation';
import {
  InteractiveUIApiName,
  InteractiveUIIdentifier,
} from '@lobechat/builtin-tool-interactive-ui';
import {
  WebOnboardingApiName,
  WebOnboardingIdentifier,
} from '@lobechat/builtin-tool-web-onboarding';
import type { ChatToolPayloadWithResult } from '@lobechat/types';

interface ToolRenderRuleTarget {
  apiName: string;
  identifier: string;
}

/** Match before results arrive so the streaming and finished UI share one mount. */
export const isInteractiveUITool = ({ apiName, identifier }: ToolRenderRuleTarget): boolean =>
  identifier === InteractiveUIIdentifier && apiName === InteractiveUIApiName.renderUI;

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

/**
 * Tools whose result IS an image the turn produced — a generated image, or a
 * Codex image output. These are the turn's deliverable, so a finished turn
 * carrying one must not fold it away.
 *
 * Deliberately excludes tools that merely READ an image (`readFile`, Claude
 * Code `Read`, the in-app browser's `screenshot`): a read is one ordinary step
 * among many, and letting it block the fold unfolded the whole process.
 */
export const isImageOutputTool = (tool: ChatToolPayloadWithResult): boolean => {
  // Image delivery failures must stay visible alongside successful outputs.
  if (tool.identifier === 'codex' && tool.apiName === 'image_output') return true;

  const state = tool.result?.state;
  if (!state) return false;

  return (
    tool.identifier === ImageGenerationIdentifier &&
    tool.apiName === ImageGenerationApiName.generateImage &&
    hasGeneratedImage(state)
  );
};

/**
 * Any tool whose result carries an image, output or read. Drives the workflow
 * breakout only: a read image still surfaces as its own row once the process is
 * unfolded, but no longer keeps that process from folding in the first place.
 */
export const isImageBearingTool = (tool: ChatToolPayloadWithResult): boolean =>
  isImageOutputTool(tool) || hasUploadedImages(tool.result?.state);

/** Native artifact state is deliberately small and retained on the transcript.
 * Prefer that live value over the separate, possibly stale lazy body cache. */
export const resolveToolResultState = <T>(
  tool: ToolRenderRuleTarget,
  liveState: T | undefined,
  storedState: T | undefined,
): T | undefined =>
  isInteractiveUITool(tool) ? (liveState ?? storedState) : (storedState ?? liveState);
