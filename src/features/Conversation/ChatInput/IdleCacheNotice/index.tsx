'use client';

import { Button, Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { InfoIcon } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { NoticeAlert } from '@/components/NoticeAlert';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useAnalytics } from '@/libs/analytics/client';

import { useConversationStore } from '../../store';
import { continueInNewTopic } from './continueInNewTopic';
import { useIdleCacheNotice } from './useIdleCacheNotice';

/**
 * Whole cents read naturally next to each other ("about $1.43, usually about $0.15"); a reply
 * cheaper than a cent never needs the notice's precision.
 */
const formatAmount = (usd: number) =>
  usd < 0.01
    ? '<$0.01'
    : `$${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(usd)}`;

/**
 * Analytics events of the notice. Each carries only the cache lifetime and an spm, no
 * conversation, message, cost or file data.
 */
const NOTICE_EVENTS = {
  dismissed: { name: 'idle_cache_notice_dismissed', spm: 'chat.idle_cache_notice.dismiss.clicked' },
  newTopic: {
    name: 'idle_cache_notice_new_topic',
    spm: 'chat.idle_cache_notice.new_topic.clicked',
  },
  shown: { name: 'idle_cache_notice_shown', spm: 'chat.idle_cache_notice.shown' },
} as const;

/**
 * Tells the user, in plain words, that the long conversation's next reply costs more, and offers a
 * fresh conversation for a new question. It never blocks the send: continuing here is a valid
 * choice.
 *
 * The line leads with what people can see, a long conversation and the price; why it costs more
 * right now (they paused long enough for the provider to drop the prompt cache) lives in the
 * tooltip. The button states the action and its effect but no amount: a fresh conversation's own
 * cost (system prompt, tools, attachments) is not estimated, so a precise saving would overclaim.
 */
const IdleCacheNotice = memo(() => {
  const { t } = useTranslation('chat');
  const notice = useIdleCacheNotice();
  const [context, editor, dismiss] = useConversationStore((s) => [
    s.context,
    s.editor,
    s.dismissIdleCacheNotice,
  ]);
  const [opening, setOpening] = useState(false);
  // A tooltip has no hover on a phone; the title and the button carry the decision alone.
  const isMobile = useIsMobile();
  const { analytics } = useAnalytics();
  const shownMessageId = notice?.snapshot.messageId;
  const ttlSeconds = notice?.snapshot.ttlSeconds;

  const track = useCallback(
    (event: (typeof NOTICE_EVENTS)[keyof typeof NOTICE_EVENTS]) => {
      try {
        analytics?.track({ name: event.name, properties: { spm: event.spm, ttlSeconds } });
      } catch {
        // silently ignore tracking errors to avoid affecting business logic
      }
    },
    [analytics, ttlSeconds],
  );

  // Once per idle period: a dismissal or a newer reply is the only way to a new one.
  const trackedShownIdRef = useRef<string>(undefined);
  useEffect(() => {
    if (!shownMessageId || !analytics || trackedShownIdRef.current === shownMessageId) return;
    trackedShownIdRef.current = shownMessageId;
    track(NOTICE_EVENTS.shown);
  }, [analytics, shownMessageId, track]);

  const handleNewTopic = useCallback(async () => {
    track(NOTICE_EVENTS.newTopic);
    setOpening(true);
    try {
      await continueInNewTopic({ context, editor });
    } finally {
      setOpening(false);
    }
  }, [context, editor, track]);

  if (!notice) return null;

  return (
    <Flexbox paddingBlock={'0 8px'}>
      <NoticeAlert
        closable
        showIcon
        type={'info'}
        action={
          <Button loading={opening} size={'small'} onClick={handleNewTopic}>
            {t('input.idleCache.newTopic')}
          </Button>
        }
        title={
          <Flexbox horizontal align={'center'} gap={4}>
            <span>
              {t('input.idleCache.title', { amount: formatAmount(notice.cost.coldCost) })}
            </span>
            {!isMobile && (
              <Tooltip
                title={t('input.idleCache.info', { usual: formatAmount(notice.cost.warmCost) })}
              >
                <Icon icon={InfoIcon} size={14} style={{ cursor: 'help', flex: 'none' }} />
              </Tooltip>
            )}
          </Flexbox>
        }
        onClose={() => {
          track(NOTICE_EVENTS.dismissed);
          dismiss(notice.snapshot.messageId);
        }}
      />
    </Flexbox>
  );
});

IdleCacheNotice.displayName = 'IdleCacheNotice';

export default IdleCacheNotice;

export { toTTLLookup } from './promptCacheState';
export { useIdleCacheNotice, usePromptCacheState } from './useIdleCacheNotice';
