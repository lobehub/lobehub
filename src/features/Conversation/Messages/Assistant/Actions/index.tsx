import { type UIChatMessage } from '@lobechat/types';
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
  'tts',
  'translate',
  'divider',
  'share',
  'divider',
  'regenerate',
  'delAndRegenerate',
  'del',
];
const ERROR_BAR: MessageActionSlot[] = ['regenerate', 'del'];
const ERROR_MENU: MessageActionSlot[] = ['edit', 'copy', 'divider', 'del'];

interface AssistantActionsBarProps {
  actionsConfig?: MessageActionsConfig;
  data: UIChatMessage;
  id: string;
}

export const AssistantActionsBar = memo<AssistantActionsBarProps>(({ actionsConfig, id, data }) => {
  const ctx = useMemo<MessageActionContext>(() => ({ data, id, role: 'assistant' }), [data, id]);

  const { error, tools } = data;

  if (error) {
    return <MessageActionBar bar={ERROR_BAR} ctx={ctx} menu={ERROR_MENU} />;
  }

  const defaultBar = tools ? DEFAULT_BAR_WITH_TOOLS : DEFAULT_BAR;

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
});

AssistantActionsBar.displayName = 'AssistantActionsBar';
