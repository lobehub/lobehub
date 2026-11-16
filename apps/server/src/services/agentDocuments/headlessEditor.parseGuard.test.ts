// @vitest-environment node
import type * as EditorRuntime from '@lobechat/editor-runtime';
import { describe, expect, it, vi } from 'vitest';

import { createAgentMarkdownSnapshot, createMarkdownEditorSnapshot } from './headlessEditor';

// Without the root repair the editor cannot place a raw HTML block, the way every
// document write failed before it: Lexical keeps only the blocks parsed so far.
vi.mock('@lobechat/editor-runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof EditorRuntime>()),
  MarkdownRootDocumentPlugin: class {
    static pluginName = 'NoMarkdownRootRepair';
    onInit() {}
  },
}));

describe('agent Markdown the editor stops parsing partway', () => {
  const markdown = [
    '## Plan',
    '',
    'Intro.',
    '',
    '<alert type="warning">',
    'Heads up.',
    '</alert>',
    '',
    '## Risks',
    '',
    'The part that used to vanish.',
  ].join('\n');

  it('cuts the document off where parsing stopped', async () => {
    const snapshot = await createMarkdownEditorSnapshot(markdown);

    expect(snapshot.content).toContain('Intro.');
    expect(snapshot.content).not.toContain('The part that used to vanish.');
  });

  it('rejects the agent write and names the line instead of saving the part before it', async () => {
    await expect(createAgentMarkdownSnapshot(markdown)).rejects.toThrow(
      'Document content could not be parsed past line 5 (`<alert type="warning">`); saving it would have dropped everything from there on, so nothing was saved.',
    );
  });
});
