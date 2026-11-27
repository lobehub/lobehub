import { ReactMathPlugin } from '@lobehub/editor';
import { createHeadlessEditor, DEFAULT_HEADLESS_EDITOR_PLUGINS } from '@lobehub/editor/headless';
import { describe, expect, it } from 'vitest';

import { createChatInputRichPlugins } from './plugins';

type HeadlessPlugin = (typeof DEFAULT_HEADLESS_EDITOR_PLUGINS)[number];

/** The props the chat input actually mounts ReactMathPlugin with. */
const chatInputMathProps = () => {
  const entry = createChatInputRichPlugins().find(
    (plugin) => Array.isArray(plugin) && plugin[0] === ReactMathPlugin,
  ) as [unknown, { enableInlineMath?: boolean }] | undefined;

  return entry?.[1];
};

/**
 * Imports Markdown the way the chat input does: the headless MathPlugin with
 * the chat input's own math props.
 */
const importMessage = (markdown: string) => {
  const props = chatInputMathProps();
  const plugins = DEFAULT_HEADLESS_EDITOR_PLUGINS.map((plugin) =>
    !Array.isArray(plugin) && plugin.pluginName === 'MathPlugin'
      ? ([plugin, props] as never)
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

describe('createChatInputRichPlugins math', () => {
  it('mounts the math plugin with inline `$…$` math turned off', () => {
    expect(chatInputMathProps()).toEqual({ enableInlineMath: false });
  });

  it('keeps shell variables in a pasted command as plain text', () => {
    const command = 'echo "LOBEHUB_CLI=$LOBEHUB_CLI"; ls -la /proc/1/exe /proc/$PPID/exe 2>&1';
    const snapshot = importMessage(command);

    expect(hasNodeType(snapshot.editorData, 'math')).toBe(false);
    expect(snapshot.markdown).toContain('$LOBEHUB_CLI');
    expect(snapshot.markdown).toContain('/proc/$PPID/exe');
  });

  it('keeps dollar prices as plain text', () => {
    const snapshot = importMessage('Plus is $5 and Pro is $10');

    expect(hasNodeType(snapshot.editorData, 'math')).toBe(false);
  });

  it('still renders a block formula', () => {
    const snapshot = importMessage('Area:\n\n$$\nx^2\n$$\n');

    expect(hasNodeType(snapshot.editorData, 'mathBlock')).toBe(true);
  });
});
