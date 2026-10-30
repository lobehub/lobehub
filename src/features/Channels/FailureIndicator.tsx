import type { ChannelDetail } from '@lobechat/types';
import { Button, Flexbox, Icon, Popover, Text, usePopoverContext } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { CircleAlert, LocateFixed } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { unresolvedFailures } from './jobStatus';
import type { ReplyEntry } from './MessageReceipts';
import { ReplyDetail, replyEntries } from './MessageReceipts';
import { statusStyles, toneStyles } from './styles';

/** Scrolls the main conversation to a message, if it is in the loaded page. */
const findMessage = (messageId: string) =>
  document.querySelector<HTMLElement>(
    `[data-channel-conversation="main"] [data-message-id="${CSS.escape(messageId)}"]`,
  );

function FailureRow({ channelId, entry }: { channelId: string; entry: ReplyEntry }) {
  const { t } = useTranslation('channel');
  const { close } = usePopoverContext();
  return (
    <Flexbox gap={4}>
      <ReplyDetail channelId={channelId} entry={entry} />
      <Button
        icon={LocateFixed}
        size="small"
        style={{ alignSelf: 'flex-start' }}
        type="text"
        onClick={() => {
          close();
          findMessage(entry.job.messageId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }}
      >
        {t('failure.locate')}
      </Button>
    </Flexbox>
  );
}

/**
 * Replies that failed and were not settled by a newer reply from the same Agent. Lives in
 * the header so the timeline stays readable; each message keeps a small marker.
 */
export function FailureIndicator({ detail }: { detail: ChannelDetail }) {
  const { t } = useTranslation('channel');
  const failures = unresolvedFailures(detail.jobs);
  if (!failures.length) return null;
  const entries = replyEntries(detail, failures, t('unnamedAgent'));
  const label = t('failure.title', { count: failures.length });

  return (
    <Popover
      placement="bottomRight"
      trigger="click"
      content={
        <Flexbox gap={12} {...stylex.props(statusStyles.popover, statusStyles.replyList)}>
          <Text fontSize={12} type="secondary" weight={500}>
            {label}
          </Text>
          {entries.map((entry) => (
            <FailureRow channelId={detail.channel.id} entry={entry} key={entry.job.id} />
          ))}
        </Flexbox>
      }
    >
      <Button
        aria-label={label}
        size="small"
        title={label}
        type="text"
        {...stylex.props(statusStyles.failureButton, toneStyles.error)}
      >
        <Icon icon={CircleAlert} size={16} />
        {failures.length}
      </Button>
    </Popover>
  );
}
