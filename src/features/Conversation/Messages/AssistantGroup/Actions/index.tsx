import { type AssistantContentBlock, type UIChatMessage } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { memo, useMemo } from 'react';

import { ReactionPicker } from '../../../components/Reaction';
import { messageStateSelectors, useConversationStore } from '../../../store';
import type { MessageActionsConfig } from '../../../types';
import {
  MessageActionBar,
  type MessageActionContext,
  type MessageActionSlot,
} from '../../components/MessageActionBar';

const DEFAULT_BAR_WITH_TOOLS: MessageActionSlot[] = ['delAndRegenerate', 'copy'];
const DEFAULT_BAR: MessageActionSlot[] = ['edit', 'copy'];
const DEFAULT_MENU: MessageActionSlot[] = [
  'edit',
  'copy',
  'branching',
  'collapse',
  'divider',
  'share',
  'select',
  'divider',
  'regenerate',
  'del',
];
const IN_PROGRESS_BAR: MessageActionSlot[] = ['del'];
// Finished turn whose last child block is a tool call (typical for heterogeneous
// CC/Codex turns, which end on a Bash/Read/Edit/Task block with no trailing text).
// There's no text block to edit/copy, but the turn IS complete — it can still be
// shared and, crucially, multi-selected/forwarded like a native reply.
const NO_TEXT_BLOCK_BAR: MessageActionSlot[] = ['delAndRegenerate'];
const NO_TEXT_BLOCK_MENU: MessageActionSlot[] = ['share', 'select', 'divider', 'del'];

interface GroupActionsProps {
  actionsConfig?: MessageActionsConfig;
  contentBlock?: AssistantContentBlock;
  contentId?: string;
  data: UIChatMessage;
  id: string;
}

export const GroupActionsBar = memo<GroupActionsProps>(
  ({ actionsConfig, id, data, contentBlock, contentId }) => {
    const ctx = useMemo<MessageActionContext>(
      () => ({ contentBlock, data, id, role: 'group' }),
      [contentBlock, data, id],
    );

    const isGenerating = useConversationStore(
      messageStateSelectors.isAssistantGroupItemGenerating(id),
    );

    // No finalized text block (group is empty, or its last child is a tool call).
    if (!contentId) {
      // Still streaming → only delete is meaningful.
      if (isGenerating) {
        return <MessageActionBar bar={IN_PROGRESS_BAR} ctx={ctx} />;
      }
      // Finished, but the turn ends on a tool-call block — no text to edit/copy,
      // yet it's a complete reply that can be shared and multi-selected/forwarded.
      return <MessageActionBar bar={NO_TEXT_BLOCK_BAR} ctx={ctx} menu={NO_TEXT_BLOCK_MENU} />;
    }

    const defaultBar = data.tools ? DEFAULT_BAR_WITH_TOOLS : DEFAULT_BAR;

    return (
      <Flexbox horizontal align={'center'} gap={8}>
        <ReactionPicker messageId={id} />
        <MessageActionBar
          bar={actionsConfig?.bar ?? defaultBar}
          ctx={ctx}
          menu={actionsConfig?.menu ?? DEFAULT_MENU}
        />
      </Flexbox>
    );
  },
);

GroupActionsBar.displayName = 'GroupActionsBar';
