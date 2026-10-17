import { ReactBlockPlugin } from '@lobehub/editor';
import { Editor } from '@lobehub/editor/react';

/**
 * Extra editor plugins for the task instruction. The block drag handle (same
 * as the page editor) lets an image or paragraph be dragged to a new position
 * instead of cut and pasted. `anchorPadding: 0` keeps the text aligned with the
 * title; the handle floats in the left gutter.
 */
export const TASK_INSTRUCTION_EXTRA_PLUGINS = [
  Editor.withProps(ReactBlockPlugin, { anchorPadding: 0 }),
];
