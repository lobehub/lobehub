'use client';

import type { MessengerOversizeImageStrategy } from '@lobechat/const';
import { DEFAULT_OVERSIZE_IMAGE_STRATEGY } from '@lobechat/const';
import { Block, Flexbox, Input } from '@lobehub/ui';
import {
  Alert,
  Button,
  ModalFooter,
  Segmented,
  Select,
  Text,
  toast,
  useModalContext,
} from '@lobehub/ui/base-ui';
import { Divider } from 'antd';
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
import { resolveOversizePlan } from './resolveOversizePlan';

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
    const [oversizeImageStrategy, setOversizeImageStrategy] =
      useState<MessengerOversizeImageStrategy>(DEFAULT_OVERSIZE_IMAGE_STRATEGY);

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

    // Pre-send oversize handling: with the file size and the platform budget
    // both known here, the trade-off can be put in front of the sender instead
    // of reported after the fact. An oversize IMAGE is a real choice — a
    // recompressed JPEG that shows inline, or the untouched original behind a
    // download link — so it gets a control, defaulted to the server's own
    // default. Anything else has no smaller representation, so it stays a
    // statement of what will happen. Size unknown → neither; the server
    // applies the same budget either way.
    const attachmentType = resolveAttachmentType(file.name, file.fileType);
    const {
      limit: budgetLimit,
      offersChoice: oversizeImage,
      oversize: isOversize,
    } = resolveOversizePlan({ attachmentType, platform, size: file.size });
    const limit = formatSize(budgetLimit, 0);

    // Why the file needs a decision reads as the file's own metadata, on the
    // line under its name — the size is the fact the limit is measured against,
    // so the two belong to each other, not to a sentence floating below the
    // card. Both halves are the same kind of information for every attachment
    // type, so both get the same shape.
    const sizeLabel = file.size ? formatSize(file.size) : undefined;
    const fileMeta = [
      sizeLabel,
      isOversize
        ? t('messenger.push.resource.oversizeMeta', { limit, platform: platformName })
        : undefined,
    ]
      .filter(Boolean)
      .join(' · ');

    // One line, always in the same place: what will actually be delivered.
    const consequence = !isOversize
      ? undefined
      : oversizeImage
        ? t(
            oversizeImageStrategy === 'compress'
              ? 'messenger.push.resource.oversizeImageCompressHint'
              : 'messenger.push.resource.oversizeImageLinkHint',
            { limit },
          )
        : t('messenger.push.resource.oversizeFileConsequence');

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
          // Only meaningful for an oversize image; sending it unconditionally
          // would let a stale toggle change nothing but still read as intent.
          oversizeImageStrategy: oversizeImage ? oversizeImageStrategy : undefined,
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
        {/* Two groups, and the gap between them is wider than the gap inside
            either: what is being sent (the file card and every decision about
            it) and how it will be sent (target, window, covering message).
            Before, one uniform 16px gap made seven peers out of them, so the
            oversize control read as unrelated to the file it belongs to. */}
        <Flexbox gap={24} padding={16}>
          <Text style={{ fontSize: 13 }} type="secondary">
            {t('messenger.push.resource.description', { platform: platformName })}
          </Text>

          {/* One region for the attachment: the name, the facts about it, and
              the choice those facts force. The decision was outside this card
              before — same indentation, same spacing as the send settings —
              which left nothing saying it applied to THIS file. */}
          <Block padding={0} variant="outlined">
            <Flexbox horizontal align="center" gap={12} padding={12}>
              <FileIcon fileName={file.name} fileType={file.fileType} size={32} />
              <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
                <Text ellipsis strong>
                  {file.name}
                </Text>
                {!!fileMeta && (
                  <Text ellipsis style={{ fontSize: 12 }} type="secondary">
                    {fileMeta}
                  </Text>
                )}
              </Flexbox>
            </Flexbox>

            {isOversize && (
              <>
                {/* Splits the region without breaking it: the decision is a
                    second part of the same card, not a second card. */}
                <Divider style={{ margin: 0 }} />
                <Flexbox gap={8} padding={12}>
                  {oversizeImage && (
                    <Segmented
                      block
                      disabled={sending}
                      value={oversizeImageStrategy}
                      options={[
                        {
                          label: t('messenger.push.resource.oversizeImageCompress'),
                          value: 'compress',
                        },
                        { label: t('messenger.push.resource.oversizeImageLink'), value: 'link' },
                      ]}
                      onChange={(value) =>
                        setOversizeImageStrategy(value as MessengerOversizeImageStrategy)
                      }
                    />
                  )}
                  {/* Same slot whether or not there was a choice to make, so
                      "what will arrive" is always read in the same place — an
                      oversize file used to say it in a blue Alert and an
                      oversize image in bare text, two shapes for one fact. */}
                  <Text style={{ fontSize: 12 }} type="secondary">
                    {consequence}
                  </Text>
                </Flexbox>
              </>
            )}
          </Block>

          {/* How it goes out. Held together at a tighter gap than the one
              above, so the group reads as one block of send settings. */}
          <Flexbox gap={12}>
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
