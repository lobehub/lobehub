import type { A2uiSurfaceRecord } from '@lobehub/a2ui';

export const A2uiIdentifier = 'lobe-a2ui';

export const A2uiApiName = {
  renderUI: 'renderUI',
} as const;

export interface RenderUIParams {
  /** A2UI 1.0 messages for one surface: createSurface, updateComponents, updateDataModel. */
  operations: unknown;
}

/** What the Render draws, and what a Channel reply carries once published. */
export interface RenderUIState {
  surface: A2uiSurfaceRecord;
}
