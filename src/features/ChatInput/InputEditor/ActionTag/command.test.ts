import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $nodesOfType,
  createEditor,
} from 'lexical';
import { describe, expect, it } from 'vitest';

import { $createActionTagNode, ActionTagNode } from './ActionTagNode';
import { INSERT_ACTION_TAG_COMMAND, registerActionTagCommand } from './command';

const skill = {
  category: 'skill' as const,
  label: 'Writing',
  skipIfExists: true,
  type: 'writing',
};

const createTestEditor = () => {
  const editor = createEditor({
    nodes: [ActionTagNode],
    onError: (error) => {
      throw error;
    },
  });
  registerActionTagCommand(editor);
  editor.update(
    () => {
      const paragraph = $createParagraphNode().append($createTextNode('Draft text'));
      $getRoot().append(paragraph);
      paragraph.selectEnd();
    },
    { discrete: true },
  );
  return editor;
};

const readTags = (editor: ReturnType<typeof createEditor>) =>
  editor.read(() =>
    $nodesOfType(ActionTagNode).map((node) => ({
      category: node.actionCategory,
      label: node.actionLabel,
      type: node.actionType,
    })),
  );

describe('skill insertion deduplication', () => {
  it('inserts only once on rapid repeated clicks and keeps the draft text', () => {
    const editor = createTestEditor();
    editor.dispatchCommand(INSERT_ACTION_TAG_COMMAND, skill);
    editor.dispatchCommand(INSERT_ACTION_TAG_COMMAND, skill);

    expect(readTags(editor)).toEqual([{ category: 'skill', label: 'Writing', type: 'writing' }]);
    expect(editor.read(() => $getRoot().getTextContent())).toContain('Draft text');
  });

  it('recognizes an existing tag in another paragraph regardless of its label', () => {
    const editor = createTestEditor();
    editor.update(
      () => {
        $getRoot().append(
          $createParagraphNode().append($createActionTagNode('writing', 'skill', 'Old title')),
        );
      },
      { discrete: true },
    );

    editor.dispatchCommand(INSERT_ACTION_TAG_COMMAND, skill);

    expect(readTags(editor)).toEqual([{ category: 'skill', label: 'Old title', type: 'writing' }]);
  });

  it('allows reinsertion after removing the tag', () => {
    const editor = createTestEditor();
    editor.dispatchCommand(INSERT_ACTION_TAG_COMMAND, skill);
    editor.update(
      () => {
        for (const node of $nodesOfType(ActionTagNode)) node.remove();
        $getRoot().selectEnd();
      },
      { discrete: true },
    );
    expect(readTags(editor)).toHaveLength(0);

    editor.dispatchCommand(INSERT_ACTION_TAG_COMMAND, skill);
    expect(readTags(editor)).toHaveLength(1);
  });

  it('keeps different identifiers and skill categories independent', () => {
    const editor = createTestEditor();
    editor.dispatchCommand(INSERT_ACTION_TAG_COMMAND, skill);
    editor.dispatchCommand(INSERT_ACTION_TAG_COMMAND, { ...skill, type: 'another-skill' });
    editor.dispatchCommand(INSERT_ACTION_TAG_COMMAND, { ...skill, category: 'projectSkill' });
    editor.dispatchCommand(INSERT_ACTION_TAG_COMMAND, { ...skill, category: 'agentSkill' });

    expect(readTags(editor)).toHaveLength(4);
  });

  it.each(['projectSkill', 'agentSkill'] as const)('deduplicates %s tags too', (category) => {
    const editor = createTestEditor();
    editor.dispatchCommand(INSERT_ACTION_TAG_COMMAND, { ...skill, category });
    editor.dispatchCommand(INSERT_ACTION_TAG_COMMAND, { ...skill, category });

    expect(readTags(editor)).toHaveLength(1);
  });

  it('does not change callers that allow repeated tags', () => {
    const editor = createTestEditor();
    const payload = { category: skill.category, label: skill.label, type: skill.type };
    editor.dispatchCommand(INSERT_ACTION_TAG_COMMAND, payload);
    editor.dispatchCommand(INSERT_ACTION_TAG_COMMAND, payload);

    expect(readTags(editor)).toHaveLength(2);
  });
});
