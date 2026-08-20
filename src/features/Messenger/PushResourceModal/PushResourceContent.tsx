'use client';

import { Block, Flexbox, Input, Text } from '@lobehub/ui';
import { Alert, Button, ModalFooter, Select, toast, useModalContext } from '@lobehub/ui/base-ui';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import FileIcon from '@/components/FileIcon';
import { messengerKeys } from '@/libs/swr/keys';
import { messengerService } from '@/services/messenger';

import type { MessengerPlatform } from '../constants';
import { getMessengerErrorMessage } from '../i18n';
import { MessengerPushWindowState } from '../IntegrationDetail/MessengerPushWindowState';
import { resolveAttachmentType } from './resolveAttachmentType';

const PUSH_WINDOW_REFRESH_INTERVAL = 5000;

export interface PushResourceFile {
  fileType?: string;
  id: string;
  name: string;
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
              type: resolveAttachmentType(file.name, file.fileType),
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
            toast.info(t('messenger.push.queuedToast', { platform: platformName }));
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
