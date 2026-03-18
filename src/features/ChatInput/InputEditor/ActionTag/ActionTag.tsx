import { CLICK_COMMAND, COMMAND_PRIORITY_LOW, type LexicalEditor } from 'lexical';
import { memo, useCallback, useEffect, useRef } from 'react';

import type { ActionTagNode } from './ActionTagNode';
import { ActionTagView } from './ActionTagView';

interface ActionTagProps {
  editor: LexicalEditor;
  label: string;
  node: ActionTagNode;
}

const ActionTag = memo<ActionTagProps>(({ node, editor, label }) => {
  const spanRef = useRef<HTMLSpanElement>(null);

  const onClick = useCallback((payload: MouseEvent) => {
    if (payload.target === spanRef.current || spanRef.current?.contains(payload.target as Node)) {
      return true;
    }
    return false;
  }, []);

  useEffect(() => {
    return editor.registerCommand(CLICK_COMMAND, onClick, COMMAND_PRIORITY_LOW);
  }, [editor, onClick]);

  return (
    <span ref={spanRef}>
      <ActionTagView category={node.actionCategory} label={label} />
    </span>
  );
});

ActionTag.displayName = 'ActionTag';

export default ActionTag;
