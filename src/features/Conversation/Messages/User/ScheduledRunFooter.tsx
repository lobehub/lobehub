'use client';

import { ActionIcon, Button, cssVar, Flexbox, Icon, Text, toast } from '@lobehub/ui';
import dayjs from 'dayjs';
import { BanIcon, ClockIcon, LoaderCircleIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { aiAgentService } from '@/services/aiAgent';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

import { useConversationStore } from '../../store';

interface ScheduledRunFooterProps {
  id: string;
}

/**
 * Pending-run footer under the user bubble a deferred run is parked on.
 *
 * A `delayed_start` persists its prompt as a real user message and points
 * `scheduledRun.userMessageId` at it, so the promise ("this will run at …") is
 * shown exactly where the user left it, with the way out attached. Deliberately
 * unboxed and muted — it is a quiet status line under the message, not an alert
 * demanding attention. Renders nothing for any other message.
 */
const ScheduledRunFooter = memo<ScheduledRunFooterProps>(({ id }) => {
  const { t } = useTranslation('chat');
  const { t: tDevice } = useTranslation('device');
  const { t: tCommon } = useTranslation('common');
  const topicId = useConversationStore((s) => s.context.topicId);
  const [cancelling, setCancelling] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const run = useChatStore((s) => {
    if (!topicId) return;
    const topic = topicSelectors.getTopicById(topicId)(s);
    const scheduledRun = topic?.metadata?.scheduledRun;
    if (!scheduledRun || scheduledRun.userMessageId !== id) return;
    if (
      topic.status === 'scheduled' ||
      (topic.status === 'failed' &&
        scheduledRun.kind === 'worktree_start' &&
        scheduledRun.error !== undefined)
    )
      return scheduledRun;
  });

  const cancelScheduledRun = useConversationStore((s) => s.cancelScheduledRun);
  const cancelWorktree = async () => {
    if (!topicId) return;
    setCancelling(true);
    try {
      const outcome = await aiAgentService.cancelWorktreeTurn(topicId);
      if (outcome === 'cancelled') {
        toast.success(tDevice('workingDirectory.worktreeSendCancelled'));
      } else {
        toast.info(tDevice('workingDirectory.worktreeCancelTooLate'));
      }
      await useChatStore
        .getState()
        .refreshTopicDetail(topicId, true)
        .catch((error) => {
          console.error('[ScheduledRunFooter] refresh after cancellation failed', error);
        });
    } catch (error) {
      console.error('[ScheduledRunFooter] cancel worktree send failed', error);
      toast.error(tDevice('workingDirectory.worktreeCancelFailed'));
    } finally {
      setCancelling(false);
    }
  };

  const retryWorktree = async () => {
    if (!topicId) return;
    setRetrying(true);
    try {
      await aiAgentService.retryWorktreeTurn(topicId);
      await useChatStore.getState().refreshTopicDetail(topicId, true);
    } catch (error) {
      console.error('[ScheduledRunFooter] retry worktree failed', error);
      toast.error(tDevice('workingDirectory.worktreeCreateFailed'));
    } finally {
      setRetrying(false);
    }
  };

  if (run?.kind === 'worktree_start') {
    if (run.error !== undefined) {
      return (
        <Flexbox horizontal justify={'flex-end'}>
          <AsyncError
            align={'start'}
            description={''}
            details={run.error}
            variant={'inline'}
            action={
              run.retryable && (
                <Button loading={retrying} size={'small'} type={'text'} onClick={retryWorktree}>
                  {tCommon('retry')}
                </Button>
              )
            }
            title={
              <Text as={'span'} type={'danger'}>
                {tDevice('workingDirectory.worktreeCreateFailed')}
              </Text>
            }
          />
        </Flexbox>
      );
    }

    return (
      <Flexbox horizontal align={'center'} gap={6} justify={'flex-end'} paddingBlock={4}>
        <Icon spin icon={LoaderCircleIcon} size={14} />
        <Text role={'status'} style={{ fontSize: 12 }} type={'secondary'}>
          {run.waitingForDevice
            ? tDevice('workingDirectory.worktreeWaitingForDevice')
            : tDevice('workingDirectory.preparingWorktree')}
        </Text>
        {!run.claim && (
          <Button loading={cancelling} size={'small'} type={'text'} onClick={cancelWorktree}>
            {tDevice('workingDirectory.cancelWorktreeSend')}
          </Button>
        )}
      </Flexbox>
    );
  }
  if (run?.kind !== 'delayed_start') return null;

  return (
    <Flexbox horizontal align={'center'} gap={4} justify={'flex-end'} paddingBlock={4}>
      <Icon icon={ClockIcon} size={14} style={{ color: cssVar.colorTextQuaternary }} />
      <Text style={{ fontSize: 12 }} type={'secondary'}>
        {t('input.schedule.pending', { time: dayjs(run.runAt).format('MM-DD HH:mm') })}
      </Text>
      <ActionIcon
        icon={BanIcon}
        size={'small'}
        title={t('input.schedule.cancel')}
        onClick={() => void cancelScheduledRun()}
      />
    </Flexbox>
  );
});

ScheduledRunFooter.displayName = 'ScheduledRunFooter';

export default ScheduledRunFooter;
