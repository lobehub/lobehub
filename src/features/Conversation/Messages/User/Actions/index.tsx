import { type UIChatMessage } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { memo, useMemo } from 'react';

import { MESSAGE_ACTION_BAR_PORTAL_ATTRIBUTES } from '@/const/messageActionPortal';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

import { type MessageActionsConfig } from '../../../types';
import {
  MessageActionBar,
  type MessageActionContext,
  type MessageActionSlot,
} from '../../components/MessageActionBar';
import MessageBranch from '../../components/MessageBranch';

const DEFAULT_BAR: MessageActionSlot[] = ['regenerate', 'edit', 'copy'];
const DEFAULT_MENU: MessageActionSlot[] = [
  'edit',
  'copy',
  'divider',
  'tts',
  'translate',
  'divider',
  'regenerate',
  'del',
];

interface UserActionsProps {
  actionsConfig?: MessageActionsConfig;
  data: UIChatMessage;
  id: string;
}

export const UserActionsBar = memo<UserActionsProps>(({ actionsConfig, id, data }) => {
  const ctx = useMemo<MessageActionContext>(() => ({ data, id, role: 'user' }), [data, id]);
  return (
    <MessageActionBar
      bar={actionsConfig?.bar ?? DEFAULT_BAR}
      ctx={ctx}
      menu={actionsConfig?.menu ?? DEFAULT_MENU}
    />
  );
});

UserActionsBar.displayName = 'UserActionsBar';

interface ActionsProps {
  data: UIChatMessage;
  disableEditing?: boolean;
  id: string;
}

const actionBarHolder = (
  <div {...{ [MESSAGE_ACTION_BAR_PORTAL_ATTRIBUTES.user]: '' }} style={{ height: '28px' }} />
);

const Actions = memo<ActionsProps>(({ id, data, disableEditing }) => {
  const { branch } = data;
  const isDevMode = useUserStore((s) => userGeneralSettingsSelectors.config(s).isDevMode);

  return (
    <Flexbox horizontal align={'center'}>
      {!disableEditing && (
        <Flexbox align={'flex-start'} role="menubar">
          {actionBarHolder}
        </Flexbox>
      )}
      {isDevMode && branch && (
        <MessageBranch
          activeBranchIndex={branch.activeBranchIndex}
          count={branch.count}
          messageId={id}
        />
      )}
    </Flexbox>
  );
});

Actions.displayName = 'UserActions';

export default Actions;
