import { SendButton as Send } from '@lobehub/editor/react';
import { Tooltip } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';

import { useChatInputResourceAccess } from '../hooks/useChatInputResourceAccess';
import { selectors, useChatInputStore } from '../store';

const SendButton = memo(() => {
  const { t } = useTranslation('setting');
  const sendMenu = useChatInputStore((s) => s.sendMenu);
  const shape = useChatInputStore((s) => s.sendButtonProps?.shape);
  const size = useChatInputStore((s) => s.sendButtonProps?.size);
  const { generating, disabled } = useChatInputStore(selectors.sendButtonProps, isEqual);
  const [send, handleStop] = useChatInputStore((s) => [s.handleSendButton, s.handleStop]);

  // Workspace viewer doesn't have `message:create` → backend would 403.
  // OR the permission gate into the existing disabled prop so the button
  // visibly grays out and a tooltip explains why.
  const { allowed: canCreate, reason } = usePermission('create_content');

  // Per-resource General-access gating: a member with view-only access on the
  // bound agent/group can read the conversation but the server rejects sends.
  const { canUseResource } = useChatInputResourceAccess();
  const viewOnly = !canUseResource;
  const canSend = canCreate && !viewOnly;

  const button = (
    <Send
      disabled={disabled || !canSend}
      generating={generating}
      menu={canSend ? (sendMenu as any) : undefined}
      placement={'topRight'}
      shape={shape}
      size={size}
      trigger={['hover']}
      onClick={generating || !canSend ? undefined : () => send()}
      onStop={() => handleStop()}
    />
  );

  if (!canCreate) return <Tooltip title={reason}>{button}</Tooltip>;
  if (viewOnly) return <Tooltip title={t('permission.viewOnlySendTip')}>{button}</Tooltip>;
  return button;
});

SendButton.displayName = 'SendButton';

export default SendButton;
