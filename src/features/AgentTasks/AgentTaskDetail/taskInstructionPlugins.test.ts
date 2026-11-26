import { ReactBlockPlugin } from '@lobehub/editor';
import { createHeadlessEditor, DEFAULT_HEADLESS_EDITOR_PLUGINS } from '@lobehub/editor/headless';
import { describe, expect, it } from 'vitest';

import {
  TASK_INSTRUCTION_EDITOR_PROPS,
  TASK_INSTRUCTION_EXTRA_PLUGINS,
} from './taskInstructionPlugins';

type HeadlessPlugin = (typeof DEFAULT_HEADLESS_EDITOR_PLUGINS)[number];

/**
 * Imports Markdown the way the task instruction editor does: the same
 * MathPlugin with the instruction's `enableInlineMath` setting.
 */
const importInstruction = (markdown: string) => {
  const plugins = DEFAULT_HEADLESS_EDITOR_PLUGINS.map((plugin) =>
    !Array.isArray(plugin) && plugin.pluginName === 'MathPlugin'
      ? ([plugin, { enableInlineMath: TASK_INSTRUCTION_EDITOR_PROPS.enableInlineMath }] as never)
      : plugin,
  ) as HeadlessPlugin[];
  const editor = createHeadlessEditor({ plugins });
  try {
    return editor.hydrateMarkdown(markdown).export();
  } finally {
    editor.destroy();
  }
};

const hasNodeType = (value: unknown, type: string): boolean => {
  if (!value || typeof value !== 'object') return false;
  if ((value as { type?: unknown }).type === type) return true;
  return Object.values(value).some((child) => hasNodeType(child, type));
};

describe('TASK_INSTRUCTION_EXTRA_PLUGINS', () => {
  it('mounts the block drag handle so content blocks such as images can be moved by dragging', () => {
    const blockPlugin = TASK_INSTRUCTION_EXTRA_PLUGINS.find(
      (plugin) => Array.isArray(plugin) && plugin[0] === ReactBlockPlugin,
    );

    expect(blockPlugin).toEqual([ReactBlockPlugin, { anchorPadding: 0 }]);
  });
});

describe('TASK_INSTRUCTION_EDITOR_PROPS', () => {
  it('keeps dollar prices in a description as plain text', () => {
    const snapshot = importInstruction('Pricing: Basic $10 / Pro $20 / Team $40');

    expect(snapshot.markdown).toContain('Basic $10 / Pro $20 / Team $40');
    expect(hasNodeType(snapshot.editorData, 'math')).toBe(false);
  });

  it('still renders a block formula', () => {
    const snapshot = importInstruction('Area:\n\n$$\nx^2\n$$\n');

    expect(hasNodeType(snapshot.editorData, 'mathBlock')).toBe(true);
  });
});
