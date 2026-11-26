import {
  ImageGenerationApiName,
  ImageGenerationIdentifier,
} from '@lobechat/builtin-tool-image-generation';
import {
  WebOnboardingApiName,
  WebOnboardingIdentifier,
} from '@lobechat/builtin-tool-web-onboarding';
import type { ChatToolPayloadWithResult } from '@lobechat/types';

import { getMcpAppFromState } from '@/libs/mcp/mcpApp';

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
 * A plan Codex proposed in plan mode (`proposed_plan`): the turn delivers the
 * plan, and its Execute plan / Keep discussing buttons, so neither folds away.
 */
export const isProposedPlanTool = (tool: ChatToolPayloadWithResult): boolean =>
  tool.identifier === 'codex' && tool.apiName === 'proposed_plan';

const deliverableTools = new Set<string>();

export const registerDeliverableTool = (identifier: string) => {
  deliverableTools.add(identifier);
};

export const isDeliverableTool = (tool: ChatToolPayloadWithResult): boolean =>
  isImageOutputTool(tool) || isProposedPlanTool(tool) || deliverableTools.has(tool.identifier);

/**
 * Any tool whose result carries an image, output or read. Drives the workflow
 * breakout only: a read image still surfaces as its own row once the process is
 * unfolded, but no longer keeps that process from folding in the first place.
 */
export const isImageBearingTool = (tool: ChatToolPayloadWithResult): boolean =>
  isImageOutputTool(tool) || hasUploadedImages(tool.result?.state);

/**
 * Tools whose result renders an interactive MCP App view. Like a produced image,
 * the view is what the turn delivers, so it stays on screen after the turn
 * while the rest of the process folds.
 */
export const isMcpAppTool = (tool: ChatToolPayloadWithResult): boolean =>
  !!getMcpAppFromState(tool.result?.state);

/** Tools that surface on their own between collapsed workflow runs. */
export const isBreakoutTool = (tool: ChatToolPayloadWithResult): boolean =>
  isImageBearingTool(tool) || isMcpAppTool(tool) || isProposedPlanTool(tool);

/**
 * A tool that only READ an image (Claude Code `Read`, `readFile`, a browser
 * `screenshot`) without producing one. The user setting
 * `showImageReadPreview` decides whether these break out of the workflow
 * collapse and open their image by default, or fold in like any other call.
 */
export const isImageReadTool = (tool: ChatToolPayloadWithResult): boolean =>
  !isImageOutputTool(tool) && hasUploadedImages(tool.result?.state);

export interface BreakoutToolOptions {
  /** Runtime flag `mcp_apps`: MCP App views break out of collapsed runs too. */
  enableMcpApps?: boolean;
  /**
   * User setting `showImageReadPreview`. Off folds image reads into the run;
   * produced images and MCP App views still break out.
   * @default true
   */
  showImageReads?: boolean;
}

/** Picks the breakout predicate for the current flags and user setting. */
export const getBreakoutPredicate = ({
  enableMcpApps,
  showImageReads = true,
}: BreakoutToolOptions): ((tool: ChatToolPayloadWithResult) => boolean) => {
  const isImageBreakout = showImageReads ? isImageBearingTool : isImageOutputTool;
  const isOutputBreakout = (tool: ChatToolPayloadWithResult) =>
    isImageBreakout(tool) || isProposedPlanTool(tool);

  return enableMcpApps ? (tool) => isOutputBreakout(tool) || isMcpAppTool(tool) : isOutputBreakout;
};
