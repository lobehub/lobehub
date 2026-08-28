import type { IEditor } from '@lobehub/editor';
import {
  $createTextNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  type RangeSelection,
} from 'lexical';

export const DICTATION_UPDATE_TAG = 'realtime-dictation';

export interface DictationAnchorSnapshot {
  anchor: number;
  prefix: string;
  suffix: string;
}

export interface DictationEditorAdapter {
  begin: (onUserEdit: () => void) => DictationAnchorSnapshot | undefined;
  dispose: () => void;
  finalize: (text: string) => void;
  render: (text: string) => void;
}

const collapseAtFocus = (selection: RangeSelection) => {
  if (selection.isCollapsed()) return selection;

  selection.anchor.set(selection.focus.key, selection.focus.offset, selection.focus.type);
  return selection;
};

const getTextAnchor = (selection: RangeSelection) => {
  const fromStart = selection.clone();
  const root = $getRoot();
  fromStart.anchor.set(root.getKey(), 0, 'element');
  return fromStart.getTextContent().length;
};

/**
 * Owns exactly one segmented Lexical text node while dictation is active.
 * Updating that node leaves the surrounding rich draft and external attachment
 * stores untouched.
 */
export class LexicalDictationEditor implements DictationEditorAdapter {
  readonly #editor: IEditor;
  #active = false;
  #nodeKey?: string;
  #savedSelection?: RangeSelection;
  #unregisterRoot?: () => void;
  #unregisterUpdate?: () => void;

  constructor(editor: IEditor) {
    this.#editor = editor;
  }

  begin(onUserEdit: () => void): DictationAnchorSnapshot | undefined {
    this.dispose();
    const lexicalEditor = this.#editor.getLexicalEditor();
    if (!lexicalEditor) return;

    let snapshot: DictationAnchorSnapshot | undefined;
    lexicalEditor.update(
      () => {
        let selection = $getSelection();
        if (!$isRangeSelection(selection)) {
          $getRoot().selectEnd();
          selection = $getSelection();
        }
        if (!$isRangeSelection(selection)) return;

        const savedSelection = collapseAtFocus(selection.clone());
        const text = $getRoot().getTextContent();
        const anchor = Math.max(0, Math.min(text.length, getTextAnchor(savedSelection)));
        this.#savedSelection = savedSelection;
        snapshot = { anchor, prefix: text.slice(0, anchor), suffix: text.slice(anchor) };
      },
      { discrete: true, tag: DICTATION_UPDATE_TAG },
    );
    if (!snapshot) return;

    this.#active = true;
    const handleUserEdit = () => {
      if (!this.#active) return;
      this.#active = false;
      onUserEdit();
    };
    this.#unregisterRoot = lexicalEditor.registerRootListener((root, previousRoot) => {
      previousRoot?.removeEventListener('beforeinput', handleUserEdit);
      previousRoot?.removeEventListener('cut', handleUserEdit);
      previousRoot?.removeEventListener('drop', handleUserEdit);
      previousRoot?.removeEventListener('paste', handleUserEdit);
      root?.addEventListener('beforeinput', handleUserEdit);
      root?.addEventListener('cut', handleUserEdit);
      root?.addEventListener('drop', handleUserEdit);
      root?.addEventListener('paste', handleUserEdit);
    });
    this.#unregisterUpdate = lexicalEditor.registerUpdateListener(
      ({ dirtyElements, dirtyLeaves, tags }) => {
        if (
          this.#active &&
          !tags.has(DICTATION_UPDATE_TAG) &&
          (dirtyElements.size > 0 || dirtyLeaves.size > 0)
        ) {
          handleUserEdit();
        }
      },
    );

    return snapshot;
  }

  render(text: string) {
    if (!this.#active) return;
    const lexicalEditor = this.#editor.getLexicalEditor();
    if (!lexicalEditor) return;

    lexicalEditor.update(
      () => {
        const existingNode = this.#nodeKey ? $getNodeByKey(this.#nodeKey) : undefined;
        if ($isTextNode(existingNode)) {
          const selection = $getSelection();
          const preservedSelection =
            $isRangeSelection(selection) &&
            selection.anchor.key !== existingNode.getKey() &&
            selection.focus.key !== existingNode.getKey()
              ? selection.clone()
              : undefined;
          existingNode.setTextContent(text);
          if (preservedSelection) $setSelection(preservedSelection);
          else existingNode.selectEnd();
          return;
        }

        if (!text || !this.#savedSelection) return;
        $setSelection(this.#savedSelection.clone());
        const node = $createTextNode(text).setMode('segmented');
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;
        selection.insertNodes([node]);
        node.selectEnd();
        this.#nodeKey = node.getKey();
      },
      { discrete: true, tag: DICTATION_UPDATE_TAG },
    );
  }

  finalize(text: string) {
    const lexicalEditor = this.#editor.getLexicalEditor();
    if (lexicalEditor) {
      lexicalEditor.update(
        () => {
          const existingNode = this.#nodeKey ? $getNodeByKey(this.#nodeKey) : undefined;
          if ($isTextNode(existingNode)) {
            const selection = $getSelection();
            const preservedSelection =
              $isRangeSelection(selection) &&
              selection.anchor.key !== existingNode.getKey() &&
              selection.focus.key !== existingNode.getKey()
                ? selection.clone()
                : undefined;
            if (text) {
              existingNode.setTextContent(text).setMode('normal');
              if (preservedSelection) $setSelection(preservedSelection);
              else existingNode.selectEnd();
            } else {
              existingNode.remove();
              if (preservedSelection) $setSelection(preservedSelection);
            }
            return;
          }

          if (!text || !this.#savedSelection) return;
          $setSelection(this.#savedSelection.clone());
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return;
          const node = $createTextNode(text);
          selection.insertNodes([node]);
          node.selectEnd();
        },
        { discrete: true, tag: DICTATION_UPDATE_TAG },
      );
    }
    this.dispose();
  }

  dispose() {
    this.#active = false;
    this.#unregisterRoot?.();
    this.#unregisterUpdate?.();
    this.#unregisterRoot = undefined;
    this.#unregisterUpdate = undefined;
    this.#nodeKey = undefined;
    this.#savedSelection = undefined;
  }
}
