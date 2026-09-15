import {
  type AwarenessCursorLabelFormatter,
  type AwarenessCursorLabelInput,
  type AwarenessCursorLabelTranslationKey,
  formatAwarenessCursorLabel,
} from '@lobehub/editor';

export type PageEditorTranslate = (key: AwarenessCursorLabelTranslationKey) => string;

/**
 * Bind the Editor cursor-label formatter to the Page application's locale.
 * Keep this adapter at the Page boundary because Editor receives a flat
 * resource bundle while the app's i18n instance owns the locale selection.
 */
export const createPageAwarenessLabelFormatter =
  (translate: PageEditorTranslate): AwarenessCursorLabelFormatter =>
  (input: AwarenessCursorLabelInput) =>
    formatAwarenessCursorLabel(input, translate);
