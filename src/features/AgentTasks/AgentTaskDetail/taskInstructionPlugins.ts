import { ReactBlockPlugin } from '@lobehub/editor';
import { Editor } from '@lobehub/editor/react';

import type { EditorCanvasProps } from '@/features/EditorCanvas';

/**
 * Extra editor plugins for the task instruction. The block drag handle (same
 * as the page editor) lets an image or paragraph be dragged to a new position
 * instead of cut and pasted. `anchorPadding: 0` keeps the text aligned with the
 * title; the handle floats in the left gutter.
 */
export const TASK_INSTRUCTION_EXTRA_PLUGINS = [
  Editor.withProps(ReactBlockPlugin, { anchorPadding: 0 }),
];

/**
 * Editor configuration of the task instruction.
 *
 * Inline `$…$` math is off, as in PageEditor: task descriptions quote prices
 * (`Basic $10 / Pro $20`) far more often than inline formulas, and the Markdown
 * import would otherwise turn the text between two prices into one formula.
 * Block `$$` math and formula nodes already in a saved instruction still render.
 */
export const TASK_INSTRUCTION_EDITOR_PROPS = {
  enableInlineMath: false,
  extraPlugins: TASK_INSTRUCTION_EXTRA_PLUGINS,
} satisfies Partial<EditorCanvasProps>;
