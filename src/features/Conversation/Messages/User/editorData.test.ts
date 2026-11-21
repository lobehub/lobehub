import { describe, expect, it } from 'vitest';

import { hasRenderableEditorData } from './editorData';

const paragraph = (children: unknown[] = []) => ({ children, type: 'paragraph' });
const state = (...blocks: unknown[]) => ({ root: { children: blocks, type: 'root' } });

describe('hasRenderableEditorData', () => {
  /**
   * Regression: an image-only message persists the composer's empty paragraph,
   * which rendered a blank line above the images.
   */
  it('treats empty paragraphs as nothing to render', () => {
    expect(hasRenderableEditorData(state(paragraph()))).toBe(false);
    expect(hasRenderableEditorData(state(paragraph(), paragraph()))).toBe(false);
  });

  it('renders paragraphs with inline nodes', () => {
    expect(hasRenderableEditorData(state(paragraph([{ text: 'hi', type: 'text' }])))).toBe(true);
    expect(hasRenderableEditorData(state(paragraph([{ type: 'mention' }])))).toBe(true);
  });

  it('renders non-paragraph blocks even when they have no children', () => {
    expect(hasRenderableEditorData(state(paragraph(), { type: 'horizontalrule' }))).toBe(true);
  });

  it('rejects missing or malformed state', () => {
    expect(hasRenderableEditorData(undefined)).toBe(false);
    expect(hasRenderableEditorData({})).toBe(false);
    expect(hasRenderableEditorData({ root: {} })).toBe(false);
  });
});
