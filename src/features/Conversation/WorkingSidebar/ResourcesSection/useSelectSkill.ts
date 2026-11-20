import { useCallback } from 'react';

import {
  INSERT_ACTION_TAG_COMMAND,
  type InsertActionTagPayload,
} from '@/features/ChatInput/InputEditor/ActionTag/command';
import type { SkillListItem } from '@/features/SkillsList';
import { useChatStore } from '@/store/chat';

/** Use the same skill tags as the slash menu and drag-and-drop, without sending a message. */
export const useSelectSkill = (
  category: Extract<InsertActionTagPayload['category'], 'skill' | 'projectSkill' | 'agentSkill'>,
  getIdentifier?: (item: SkillListItem) => string | undefined,
) => {
  const editor = useChatStore((s) => s.mainInputEditor?.instance);
  const selectSkill = useCallback(
    (item: SkillListItem) => {
      const type = getIdentifier
        ? getIdentifier(item)
        : category === 'projectSkill'
          ? item.name
          : item.id;
      if (!editor || !type) return;

      editor.focus();
      editor.dispatchCommand(INSERT_ACTION_TAG_COMMAND, {
        category,
        label: item.name,
        skipIfExists: true,
        type,
      });
    },
    [category, editor, getIdentifier],
  );

  // Document-only surfaces retain their browsing behavior when no composer is mounted.
  return editor ? selectSkill : undefined;
};
