import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
  ElementNode,
  type LexicalEditor,
  type NodeKey,
} from 'lexical';
import { describe, expect, it } from 'vitest';

import { getSectionTitle } from './presenceSection';

class TestHeadingNode extends ElementNode {
  static getType() {
    return 'heading';
  }

  static clone(node: TestHeadingNode) {
    return new TestHeadingNode(node.__key);
  }

  static importJSON() {
    return new TestHeadingNode();
  }

  createDOM() {
    return document.createElement('h2');
  }

  updateDOM() {
    return false;
  }
}

const buildPage = () => {
  const editor = createEditor({
    nodes: [TestHeadingNode],
    onError: (error) => {
      throw error;
    },
  });
  const keys: Record<string, NodeKey> = {};

  editor.update(
    () => {
      const root = $getRoot();
      const intro = $createTextNode('Before any heading');
      root.append($createParagraphNode().append(intro));

      const rollout = new TestHeadingNode().append($createTextNode('Rollout plan'));
      const week1 = $createTextNode('Week 1 ships to internal workspaces');
      const week1Paragraph = $createParagraphNode().append(week1);
      root.append(rollout, week1Paragraph, $createParagraphNode().append($createTextNode('More')));

      keys.intro = intro.getKey();
      keys.rolloutHeadingText = rollout.getFirstChildOrThrow().getKey();
      keys.week1 = week1.getKey();
      keys.week1Paragraph = week1Paragraph.getKey();
    },
    { discrete: true },
  );

  return { editor, keys };
};

describe('getSectionTitle', () => {
  let page: { editor: LexicalEditor; keys: Record<string, NodeKey> };

  it('names the nearest heading above a text node', () => {
    page = buildPage();

    expect(getSectionTitle(page.editor, page.keys.week1)).toBe('Rollout plan');
  });

  it('names the heading itself when the cursor is inside it', () => {
    page = buildPage();

    expect(getSectionTitle(page.editor, page.keys.rolloutHeadingText)).toBe('Rollout plan');
  });

  it('works for a block-level key', () => {
    page = buildPage();

    expect(getSectionTitle(page.editor, page.keys.week1Paragraph)).toBe('Rollout plan');
  });

  it('returns nothing above the first heading or for an unknown key', () => {
    page = buildPage();

    expect(getSectionTitle(page.editor, page.keys.intro)).toBeUndefined();
    expect(getSectionTitle(page.editor, 'missing')).toBeUndefined();
  });
});
