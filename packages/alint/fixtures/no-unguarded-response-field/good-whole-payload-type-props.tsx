// Fixture: props typed with whole payload types from @lobechat/types, not slices of a response.
import type { ChannelDetail, ChannelPublicMessage } from '@lobechat/types';
import { memo } from 'react';

import { MessageAttachments } from './MessageAttachments';

interface ChannelMessageProps {
  detail: ChannelDetail;
  message: ChannelPublicMessage;
  onStartThread?: (attachmentIds: string[]) => void;
}

const ChannelMessage = memo<ChannelMessageProps>(({ detail, message, onStartThread }) => {
  const failed = detail.jobs.some((job) => job.messageId === message.id && job.status === 'failed');
  const startThread = () =>
    onStartThread?.(
      detail.attachments.filter((file) => message.fileIds.includes(file.id)).map((file) => file.id),
    );

  return (
    <article data-failed={failed || undefined}>
      {message.fileIds.length > 0 && (
        <MessageAttachments attachments={detail.attachments} fileIds={message.fileIds} />
      )}
      <p>{message.content}</p>
      <button type="button" onClick={startThread}>
        Start thread
      </button>
    </article>
  );
});

export default ChannelMessage;
