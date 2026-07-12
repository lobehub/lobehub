import { type UIChatMessage } from '@lobechat/types';
import { memo, useMemo } from 'react';

import type { MessageActionsConfig } from '../../../types';
import {
  MessageActionBar,
  type MessageActionContext,
  type MessageActionSlot,
} from '../../components/MessageActionBar';

const DEFAULT_BAR_WITH_TOOLS: MessageActionSlot[] = ['copy'];
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
const ERROR_BAR: MessageActionSlot[] = ['regenerate', 'del'];

interface AssistantActionsBarProps {
  actionsConfig?: MessageActionsConfig;
  data: UIChatMessage;
  id: string;
}

/**
 * Action bar for Task / Tasks / GroupTasks messages. Uses `assistant` role
 * context but with a slimmer default menu (no tts / translate /
 * delAndRegenerate).
 */
export const AssistantActionsBar = memo<AssistantActionsBarProps>(({ actionsConfig, id, data }) => {
  const ctx = useMemo<MessageActionContext>(() => ({ data, id, role: 'assistant' }), [data, id]);

  const { error, tools } = data;

  // Error messages render an interception card, not user-authored content —
  // editing or copying them makes no sense, so no overflow menu is offered
  if (error) {
    return <MessageActionBar bar={ERROR_BAR} ctx={ctx} />;
  }

  const defaultBar = tools ? DEFAULT_BAR_WITH_TOOLS : DEFAULT_BAR;

  return (
    <MessageActionBar
      bar={actionsConfig?.bar ?? defaultBar}
      ctx={ctx}
      menu={actionsConfig?.menu ?? DEFAULT_MENU}
    />
  );
});

AssistantActionsBar.displayName = 'TaskAssistantActionsBar';
