import { CLICK_COMMAND, COMMAND_PRIORITY_LOW, type LexicalEditor } from 'lexical';
import { memo, useCallback, useEffect, useRef } from 'react';

import { ActionMention } from './ActionMention';
import type { ActionTagNode } from './ActionTagNode';

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
    <span ref={spanRef} style={{ verticalAlign: -3 }}>
      <ActionMention category={node.actionCategory} label={label} />
    </span>
  );
});

ActionTag.displayName = 'ActionTag';

export default ActionTag;
