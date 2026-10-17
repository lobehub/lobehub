import type { NativeUIDocument, NativeUIState } from './native/types';

export const InteractiveUIIdentifier = 'lobe-interactive-ui';
export const InteractiveUIApiName = { renderUI: 'renderUI' } as const;

/** Historical persisted artifacts only; new tool calls use the native v2 contract. */
export interface LegacyRenderUIParams {
  css: string;
  fallback: string;
  html: string;
  js: string;
  title: string;
  version: 1;
}

export type RenderUIParams = NativeUIDocument;

/** Result-domain data only; the source is already persisted in tool arguments. */
export type RenderUIState =
  { status: 'ready'; version: 1 } | { status: 'ready'; values: NativeUIState; version: 2 };
