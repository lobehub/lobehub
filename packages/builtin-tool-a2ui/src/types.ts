import {
  A2UI_TOOL_IDENTIFIER,
  A2UI_TOOL_NAME,
  type A2uiToolParams,
  type A2uiToolState,
} from '@lobehub/a2ui';

export const A2uiIdentifier = A2UI_TOOL_IDENTIFIER;

export const A2uiApiName = {
  renderUI: A2UI_TOOL_NAME,
} as const;

/** A2UI 1.0 messages for one surface: createSurface, updateComponents, updateDataModel. */
export type RenderUIParams = A2uiToolParams;

/** What the Render draws, and what a Channel reply carries once published. */
export type RenderUIState = A2uiToolState;
