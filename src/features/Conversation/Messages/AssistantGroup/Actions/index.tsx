import { type AssistantContentBlock, type UIChatMessage } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { memo, useMemo } from 'react';

import { ReactionPicker } from '../../../components/Reaction';
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
  'collapse',
  'divider',
  'share',
  'divider',
  'regenerate',
  'del',
];
const IN_PROGRESS_BAR: MessageActionSlot[] = ['del'];

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

    // No finalized text block yet (group is either empty or last child is a
    // still-running tool call). Only delete is meaningful here.
    if (!contentId) {
      return <MessageActionBar bar={IN_PROGRESS_BAR} ctx={ctx} />;
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
