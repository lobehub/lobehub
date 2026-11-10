'use client';

import type { AgentMailAttachment } from '@lobechat/types';
import { Button, Flexbox, Text } from '@lobehub/ui';
import { Download } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import FileIcon from '@/components/FileIcon';
import {
  agentAccountService,
  AttachmentDownloadError,
  type AttachmentFailure,
} from '@/services/agentAccount';

import { identityStyles } from './styles';

/** `2.4 MB`, `512 KB` — enough to tell a photo from a document at a glance. */
const formatAttachmentSize = (bytes?: number): string | undefined => {
  if (!bytes) return undefined;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
};

const saveBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // Revoked a tick later: Safari reads the URL after the click returns.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

type RowState = AttachmentFailure | 'idle' | 'loading';

const AttachmentRow = memo<{ attachment: AgentMailAttachment; mailId: string }>(
  ({ attachment, mailId }) => {
    const { t } = useTranslation('setting');
    const [state, setState] = useState<RowState>('idle');
    const name = attachment.filename || attachment.contentType || `#${attachment.index}`;

    const download = async () => {
      setState('loading');
      try {
        saveBlob(await agentAccountService.downloadMailAttachment(mailId, attachment.index), name);
        setState('idle');
      } catch (error) {
        console.error('[AgentMail] attachment download failed', error);
        setState(error instanceof AttachmentDownloadError ? error.reason : 'unavailable');
      }
    };

    // Expired and too large are final; only an outage is worth another try.
    const final = state === 'expired' || state === 'too_large';
    const note =
      state === 'expired'
        ? t('identity.inbox.detail.attachmentExpired')
        : state === 'too_large'
          ? t('identity.inbox.detail.attachmentTooLarge')
          : state === 'unavailable'
            ? t('identity.inbox.detail.attachmentFailed')
            : formatAttachmentSize(attachment.size);

    return (
      <Flexbox
        horizontal
        align={'center'}
        className={identityStyles.attachmentRow}
        data-testid={'mail-attachment'}
        gap={8}
        justify={'space-between'}
      >
        <FileIcon fileName={attachment.filename ?? ''} size={24} />
        <Flexbox flex={1} style={{ minWidth: 0 }}>
          <Text ellipsis fontSize={13}>
            {name}
          </Text>
          {note && (
            <Text fontSize={12} type={state === 'unavailable' ? 'danger' : 'secondary'}>
              {note}
            </Text>
          )}
        </Flexbox>
        <Button
          disabled={final}
          icon={Download}
          loading={state === 'loading'}
          size={'small'}
          type={'text'}
          onClick={() => void download()}
        >
          {state === 'unavailable'
            ? t('identity.inbox.detail.retry')
            : t('identity.inbox.detail.download')}
        </Button>
      </Flexbox>
    );
  },
);

AttachmentRow.displayName = 'AgentMailAttachmentRow';

const MailAttachments = memo<{ attachments: AgentMailAttachment[]; mailId: string }>(
  ({ attachments, mailId }) => (
    <Flexbox gap={6}>
      {attachments.map((attachment) => (
        <AttachmentRow attachment={attachment} key={attachment.index} mailId={mailId} />
      ))}
    </Flexbox>
  ),
);

MailAttachments.displayName = 'AgentMailAttachments';

export default MailAttachments;
