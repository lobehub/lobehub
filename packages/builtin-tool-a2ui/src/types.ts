import { A2UI_TOOL_IDENTIFIER } from '@lobehub/a2ui/records';
import {
  A2UI_DOCS_TOOL_NAME,
  A2UI_TOOL_NAME,
  type A2uiDocsParams,
  type A2uiToolParams,
  type A2uiToolState,
} from '@lobehub/a2ui/tool';

export const A2uiIdentifier = A2UI_TOOL_IDENTIFIER;

export const A2uiApiName = {
  readCardDocs: A2UI_DOCS_TOOL_NAME,
  renderUI: A2UI_TOOL_NAME,
} as const;

/** Component or function names from the card guide's index, to read in full. */
export type ReadCardDocsParams = A2uiDocsParams;

/** A2UI 1.0 messages for one surface: createSurface, updateComponents, updateDataModel. */
export type RenderUIParams = A2uiToolParams;

/** What the Render draws, and what a Channel reply carries once published. */
export type RenderUIState = A2uiToolState;
