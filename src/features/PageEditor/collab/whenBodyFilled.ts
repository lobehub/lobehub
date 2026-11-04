import { $getRoot, $isElementNode, type LexicalEditor } from 'lexical';

const isBodyEmpty = (editor: LexicalEditor) =>
  editor.getEditorState().read(() => {
    const root = $getRoot();
    if (root.getChildrenSize() > 1) return false;
    const first = root.getFirstChild();
    return !first || ($isElementNode(first) && first.getChildrenSize() === 0);
  });

// A room reports `synced` before the binding's write of its body commits to the
// editor, so revealing the editor on `synced` can show an empty page. A page
// that really is empty never fills, hence the timeout.
export const whenBodyFilled = (
  editor: LexicalEditor | null | undefined,
  timeoutMs: number,
  onFilled: () => void,
): (() => void) => {
  if (!editor || !isBodyEmpty(editor)) {
    onFilled();
    return () => {};
  }

  let settled = false;
  const stop = () => {
    settled = true;
    clearTimeout(timer);
    unregister();
  };
  const finish = () => {
    if (settled) return;
    stop();
    onFilled();
  };
  const unregister = editor.registerUpdateListener(() => {
    if (!isBodyEmpty(editor)) finish();
  });
  const timer = setTimeout(finish, timeoutMs);

  return stop;
};
