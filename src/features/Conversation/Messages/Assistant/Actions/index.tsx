import { LOADING_FLAT } from '@lobechat/const';
import { type UIChatMessage } from '@lobechat/types';
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
// The developer-facing actions live one level down, under Advanced: each is
// gated (dev mode, Labs) and rare, so flat they were noise in the menu that
// every user opens. It sits with the other utilities rather than after Delete —
// trailing the destructive group made a debugging aid read as a last resort.
// The submenu drops itself when none of its children apply.
const ADVANCED_GROUP: MessageActionSlot = {
  children: ['copyMessageId', 'copyOperationId', 'saveAsEvalCase'],
  key: 'advanced',
};
const DEFAULT_MENU: MessageActionSlot[] = [
  'edit',
  'copy',
  'comments',
  'branching',
  'collapse',
  'divider',
  'tts',
  'translate',
  'divider',
  'share',
  'select',
  'divider',
  ADVANCED_GROUP,
  'divider',
  'regenerate',
  'delAndRegenerate',
  'del',
];
const ERROR_BAR: MessageActionSlot[] = ['regenerate', 'del'];
const EMPTY_ERROR_MENU: MessageActionSlot[] = ['copyOperationId'];
const ERROR_MENU: MessageActionSlot[] = [
  'edit',
  'copy',
  'copyOperationId',
  'comments',
  'divider',
  'del',
];

interface AssistantActionsBarProps {
  actionsConfig?: MessageActionsConfig;
  data: UIChatMessage;
  id: string;
}

export const AssistantActionsBar = memo<AssistantActionsBarProps>(({ actionsConfig, id, data }) => {
  const ctx = useMemo<MessageActionContext>(() => ({ data, id, role: 'assistant' }), [data, id]);

  const { content, error, tools } = data;

  // Empty error messages render only an interception card — nothing to edit
  // or copy, so only the dev-mode operation-id action remains menu-worthy
  // (failed runs are exactly what it traces; the menu collapses away when the
  // action opts out). When the turn streamed content before erroring, keep
  // edit/copy so the partial reply stays salvageable.
  if (error) {
    const hasContent = !!content && content !== LOADING_FLAT && String(content).trim() !== '';
    return (
      <MessageActionBar
        bar={ERROR_BAR}
        ctx={ctx}
        menu={hasContent ? ERROR_MENU : EMPTY_ERROR_MENU}
      />
    );
  }

  const defaultBar = tools ? DEFAULT_BAR_WITH_TOOLS : DEFAULT_BAR;

  return (
    <MessageActionBar
      bar={actionsConfig?.bar ?? defaultBar}
      ctx={ctx}
      leading={<ReactionPicker messageId={id} />}
      menu={actionsConfig?.menu ?? DEFAULT_MENU}
    />
  );
});

AssistantActionsBar.displayName = 'AssistantActionsBar';
