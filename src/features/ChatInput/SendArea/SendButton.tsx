import { SendButton as Send } from '@lobehub/editor/react';
import { Flexbox, Tooltip } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';

import { useChatInputResourceAccess } from '../hooks/useChatInputResourceAccess';
import { selectors, useChatInputStore } from '../store';
import StopButton from './StopButton';

const SendButton = memo(() => {
  const { t } = useTranslation('setting');
  const sendMenu = useChatInputStore((s) => s.sendMenu);
  const shape = useChatInputStore((s) => s.sendButtonProps?.shape);
  const size = useChatInputStore((s) => s.sendButtonProps?.size);
  const {
    generating,
    disabled,
    loading: dispatching,
    showSendWhileGenerating,
  } = useChatInputStore(selectors.sendButtonProps, isEqual);
  const [send, handleStop] = useChatInputStore((s) => [s.handleSendButton, s.handleStop]);
  // A send that is committed but not yet sent shows as a loading Send: Market
  // agents/skills picked from the @ menu are installing, or uploads are settling.
  const installing = useChatInputStore((s) => s.installingMarketMentions);
  const queuedForUploads = useChatInputStore(selectors.isSendQueuedForUploads);
  const queued = installing || queuedForUploads;

  // Workspace viewer doesn't have `message:create` → backend would 403.
  // OR the permission gate into the existing disabled prop so the button
  // visibly grays out and a tooltip explains why.
  const { allowed: canCreate, reason } = usePermission('create_content');

  // Per-resource General-access gating: a member with view-only access on the
  // bound agent/group can read the conversation but the server rejects sends.
  const { canUseResource } = useChatInputResourceAccess();
  const viewOnly = !canUseResource;
  const canSend = canCreate && !viewOnly;

  // Only a queued send spins (on Send). A running turn shows a static Stop; the
  // run itself is indicated once, by RunningIndicator beside the model selector.
  // Send sits beside Stop for the follow-up the user typed (Enter sends too).
  const stop = <StopButton shape={shape} size={size} onStop={() => handleStop()} />;
  const button =
    generating && showSendWhileGenerating ? (
      <Flexbox horizontal align={'center'} gap={8}>
        {stop}
        <Send
          disabled={disabled || !canSend}
          loading={queued}
          shape={shape}
          size={size}
          onClick={canSend ? () => send() : undefined}
        />
      </Flexbox>
    ) : generating ? (
      stop
    ) : (
      <Send
        disabled={disabled || !canSend}
        loading={queued || dispatching}
        menu={canSend ? (sendMenu as any) : undefined}
        placement={'topRight'}
        shape={shape}
        size={size}
        trigger={['hover']}
        onClick={canSend ? () => send() : undefined}
      />
    );

  if (!canCreate) return <Tooltip title={reason}>{button}</Tooltip>;
  if (viewOnly) return <Tooltip title={t('permission.viewOnlySendTip')}>{button}</Tooltip>;
  return button;
});

SendButton.displayName = 'SendButton';

export default SendButton;
