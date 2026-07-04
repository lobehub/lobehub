import { CLICK_COMMAND, COMMAND_PRIORITY_LOW, type LexicalEditor } from 'lexical';
import { memo, useCallback, useEffect, useRef } from 'react';

import { useProjectSkillResolver } from '@/features/SkillsList/useProjectSkillResolver';

import { useAgentId } from '../../hooks/useAgentId';
import { ActionMention } from './ActionMention';
import type { ActionTagNode } from './ActionTagNode';

interface ActionTagProps {
  editor: LexicalEditor;
  label: string;
  node: ActionTagNode;
}

const ActionTag = memo<ActionTagProps>(({ node, editor, label }) => {
  const spanRef = useRef<HTMLSpanElement>(null);

  // Project skills carry a filesystem SKILL.md the user can open in the portal;
  // resolve the tag by its bare name against the active session's skill list.
  const agentId = useAgentId();
  const resolveProjectSkill = useProjectSkillResolver(agentId);
  const skill =
    node.actionCategory === 'projectSkill' ? resolveProjectSkill(node.actionType) : undefined;
  const open = skill?.open;

  // The chip lives inside contentEditable, so route clicks through Lexical's
  // CLICK_COMMAND (not a React onClick) to avoid fighting caret placement.
  const onClick = useCallback(
    (payload: MouseEvent) => {
      if (payload.target === spanRef.current || spanRef.current?.contains(payload.target as Node)) {
        open?.();
        return true;
      }
      return false;
    },
    [open],
  );

  useEffect(() => {
    return editor.registerCommand(CLICK_COMMAND, onClick, COMMAND_PRIORITY_LOW);
  }, [editor, onClick]);

  return (
    <span ref={spanRef} style={{ verticalAlign: -3 }}>
      <ActionMention
        category={node.actionCategory}
        clickable={!!open}
        description={skill?.description}
        label={label}
      />
    </span>
  );
});

ActionTag.displayName = 'ActionTag';

export default ActionTag;
