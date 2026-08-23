'use client';

import { MESSENGER_ATTACHMENT_BUDGETS } from '@lobechat/const';
import { Block, Flexbox, Input, Text } from '@lobehub/ui';
import { Alert, Button, ModalFooter, Select, toast, useModalContext } from '@lobehub/ui/base-ui';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import FileIcon from '@/components/FileIcon';
import { messengerKeys } from '@/libs/swr/keys';
import { messengerService } from '@/services/messenger';
import { formatSize } from '@/utils/format';

import type { MessengerPlatform } from '../constants';
import { getMessengerErrorMessage, getMessengerQueuedToast } from '../i18n';
import { MessengerPushWindowState } from '../IntegrationDetail/MessengerPushWindowState';
import { resolveAttachmentType } from './resolveAttachmentType';

const PUSH_WINDOW_REFRESH_INTERVAL = 5000;

export interface PushResourceFile {
  fileType?: string;
  id: string;
  name: string;
  /**
   * Byte size when the caller has it — drives the pre-send oversize hint
   * (image → "will be compressed", file → "sent as a link"). When absent the
   * hint is skipped; the server still applies the same budget on send.
   */
  size?: number;
}

export interface PushResourceTarget {
  label: string;
  tenantId: string;
}

export interface PushResourceModalProps {
  file: PushResourceFile;
  platform: MessengerPlatform;
  platformName: string;
  /** Slack only: one entry per linked workspace; selection happens in-modal. */
  targets?: PushResourceTarget[];
}

/**
 * Modal body for pushing one resource file to a linked messenger channel.
 * Mirrors the settings-page `MessengerPushSection` semantics: the window
 * status drives whether the send is possible (WeChat is windowed; the other
 * platforms are always-open), and the result statuses reuse the same toasts.
 */
export const PushResourceContent = memo<PushResourceModalProps>(
  ({ file, platform, platformName, targets }) => {
    const { t } = useTranslation(['messenger', 'common']);
    const { close } = useModalContext();
    const [content, setContent] = useState('');
    const [sending, setSending] = useState(false);
    const [tenantId, setTenantId] = useState(targets?.[0]?.tenantId);

    const windowSWR = useSWR(
      messengerKeys.pushWindow(platform, tenantId),
      () => messengerService.getMessengerPushWindow(platform, tenantId),
      {
        refreshInterval: platform === 'wechat' ? PUSH_WINDOW_REFRESH_INTERVAL : 0,
        refreshWhenHidden: false,
        refreshWhenOffline: false,
      },
    );
    const status = windowSWR.data;

    const canPush = status?.deliverability === 'always' ? status.linked : !!status?.windowOpen;

    // Pre-send oversize hint: with the file size and the platform budget both
    // known here, tell the user up front whether the server will compress the
    // image or degrade the file to a download link (mirrors attachmentBudget
    // on the server). Size unknown → no hint; the result toast still reports
    // what actually happened.
    const attachmentType = resolveAttachmentType(file.name, file.fileType);
    const budget = MESSENGER_ATTACHMENT_BUDGETS[platform];
    const budgetLimit = attachmentType === 'image' ? budget.imageMaxBytes : budget.fileMaxBytes;
    const oversizeHint =
      file.size && file.size > budgetLimit
        ? t(
            attachmentType === 'image'
              ? 'messenger.push.resource.oversizeImageHint'
              : 'messenger.push.resource.oversizeFileHint',
            { limit: formatSize(budgetLimit, 0), platform: platformName },
          )
        : undefined;

    const handleSend = async () => {
      if (sending || !canPush) return;

      setSending(true);
      try {
        // Send the file by id — the server resolves it to a stable access URL
        // and reads the name/MIME type off the owned row (a client-side
        // presigned URL can expire before the platform sender downloads it,
        // silently dropping the attachment).
        const result = await messengerService.sendMessengerPush({
          attachments: [
            {
              fileId: file.id,
              type: attachmentType,
            },
          ],
          content: content.trim() || undefined,
          platform,
          tenantId,
        });
        switch (result.status) {
          case 'sent': {
            toast.success(
              result.remaining === undefined
                ? t('messenger.push.sentToast', { platform: platformName })
                : t('messenger.push.sentWindowedToast', {
                    platform: platformName,
                    remaining: result.remaining,
                  }),
            );
            close();
            break;
          }
          case 'queued': {
            toast.info(getMessengerQueuedToast(t, platformName, result.reason));
            close();
            break;
          }
          case 'unlinked': {
            toast.warning(t('messenger.push.unlinkedToast', { platform: platformName }));
            break;
          }
          default: {
            toast.warning(t('messenger.push.unavailableToast'));
          }
        }
        await windowSWR.mutate();
      } catch (error) {
        toast.error(getMessengerErrorMessage(error, t, 'messenger.push.unavailableToast'));
      } finally {
        setSending(false);
      }
    };

    return (
      <>
        <Flexbox gap={16} padding={16}>
          <Text style={{ fontSize: 13 }} type="secondary">
            {t('messenger.push.resource.description', { platform: platformName })}
          </Text>

          <Block padding={12} variant="outlined">
            <Flexbox horizontal align="center" gap={12}>
              <FileIcon fileName={file.name} fileType={file.fileType} size={32} />
              <Flexbox flex={1} style={{ minWidth: 0 }}>
                <Text ellipsis strong>
                  {file.name}
                </Text>
              </Flexbox>
            </Flexbox>
          </Block>

          {oversizeHint && <Alert showIcon message={oversizeHint} type="info" />}

          {targets && targets.length > 1 && (
            <Flexbox gap={6}>
              <Text style={{ fontSize: 12 }} type="secondary">
                {t('messenger.push.target')}
              </Text>
              <Select
                value={tenantId}
                options={targets.map((target) => ({
                  label: target.label,
                  value: target.tenantId,
                }))}
                onChange={(value) => setTenantId(value as string)}
              />
            </Flexbox>
          )}

          <MessengerPushWindowState
            error={windowSWR.error}
            name={platformName}
            status={status}
            onRetry={() => windowSWR.mutate()}
          />

          {!!status?.queued && (
            <Alert
              showIcon
              type="info"
              message={t('messenger.push.queued', {
                count: status.queued,
                platform: platformName,
              })}
            />
          )}

          <Input
            disabled={sending}
            placeholder={t('messenger.push.resource.placeholder')}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onPressEnter={handleSend}
          />
        </Flexbox>

        <ModalFooter>
          <Button onClick={() => close()}>{t('cancel', { ns: 'common' })}</Button>
          <Button disabled={!canPush} loading={sending} type="primary" onClick={handleSend}>
            {t('messenger.push.send', { platform: platformName })}
          </Button>
        </ModalFooter>
      </>
    );
  },
);

PushResourceContent.displayName = 'PushResourceContent';
