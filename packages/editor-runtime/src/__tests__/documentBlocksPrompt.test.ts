import { documentBlocksPrompt } from '@lobechat/prompts';
import { createHeadlessEditor } from '@lobehub/editor/headless';
import { describe, expect, it } from 'vitest';

const examples = (language: 'markdown' | 'xml') => {
  const fence = language === 'markdown' ? '````' : '```';
  const pattern = new RegExp(`${fence}${language}\\n([\\s\\S]*?)\\n${fence}(?!\`)`, 'g');
  return [...documentBlocksPrompt.matchAll(pattern)].map((match) => match[1]);
};

const nodeTypes = (editorData: unknown) =>
  new Set([...JSON.stringify(editorData).matchAll(/"type":"([\w-]+)"/g)].map((match) => match[1]));

const RICH_NODE_TYPES = ['alert', 'chart', 'footnote', 'footnote-section', 'footnote-definition'];

describe('documentBlocksPrompt', () => {
  it('shows a LiteXML example that parses into every rich block it documents', () => {
    const [xml] = examples('xml');
    const editor = createHeadlessEditor();
    editor.hydrateLiteXML(`<root>${xml}</root>`);
    const { editorData } = editor.export();

    expect([...nodeTypes(editorData)]).toEqual(expect.arrayContaining(RICH_NODE_TYPES));
    expect(JSON.stringify(editorData)).toContain('"colAligns":["left","right"]');
    expect(JSON.stringify(editorData)).not.toContain('"spec":null');
  });

  it('shows a Markdown example that parses into the same rich blocks', () => {
    const [markdown] = examples('markdown');
    const editor = createHeadlessEditor();
    editor.hydrateMarkdown(markdown);

    const { editorData } = editor.export();

    expect([...nodeTypes(editorData)]).toEqual(expect.arrayContaining(RICH_NODE_TYPES));
    expect(JSON.stringify(editorData)).not.toContain('"spec":null');
  });
});
