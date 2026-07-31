'use client';

import { Alert, Block, Flexbox, Icon, Input, Skeleton, Tag, Text } from '@lobehub/ui';
import { Button, Select } from '@lobehub/ui/base-ui';
import { App } from 'antd';
import { createStaticStyles } from 'antd-style';
import { CheckCircle2Icon, ClockIcon, MoonIcon, RefreshCwIcon, SendIcon } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { messengerKeys } from '@/libs/swr/keys';
import { messengerService } from '@/services/messenger';

import type { MessengerPlatform } from '../constants';
import { getMessengerErrorMessage } from '../i18n';
import { styles } from './shared';

const PUSH_WINDOW_REFRESH_INTERVAL = 5000;
const PUSH_WINDOW_DEFAULT_MAX_SENDS = 10;

const pushStyles = createStaticStyles(({ css, cssVar }) => ({
  quotaText: css`
    font-size: 13px;
    color: ${cssVar.colorText};
    white-space: nowrap;

    > span {
      color: ${cssVar.colorTextSecondary};
    }
  `,
  statBar: css`
    width: 4px;
    height: 16px;
    border-radius: 2px;
    background: ${cssVar.colorFillSecondary};

    &[data-filled='true'] {
      background: ${cssVar.colorInfo};
    }
  `,
}));

/** Discrete best-effort quota meter: one bar per locally tracked send. */
const QuotaBars = memo<{ remaining: number; total: number }>(({ remaining, total }) => (
  <Flexbox horizontal align="center" gap={3}>
    {Array.from({ length: total }, (_, index) => (
      <div className={pushStyles.statBar} data-filled={index < remaining} key={index} />
    ))}
  </Flexbox>
));
QuotaBars.displayName = 'MessengerPushQuotaBars';

export interface MessengerPushTarget {
  label: string;
  tenantId: string;
}

interface MessengerPushSectionProps {
  name: string;
  platform: MessengerPlatform;
  targets?: MessengerPushTarget[];
}

/**
 * "Message Push" section shared by every System Bot integration.
 *
 * WeChat only lets the bot deliver messages inside a send window opened by the
 * user's own inbound message (10 sends / 24h). Slack, Telegram and Discord can
 * open a DM at any time. Slack additionally carries a workspace tenant target
 * so the server resolves the matching installation token.
 */
export const MessengerPushSection = memo<MessengerPushSectionProps>(
  ({ name, platform, targets }) => {
    const { t } = useTranslation('messenger');
    const { message } = App.useApp();
    const [content, setContent] = useState('');
    const [sending, setSending] = useState(false);
    const [tenantId, setTenantId] = useState(targets?.[0]?.tenantId);

    useEffect(() => {
      if (!targets?.length) {
        setTenantId(undefined);
        return;
      }
      if (!targets.some((target) => target.tenantId === tenantId)) {
        setTenantId(targets[0].tenantId);
      }
    }, [targets, tenantId]);

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
      const text = content.trim();
      if (!text || sending || !canPush) return;

      setSending(true);
      try {
        const result = await messengerService.sendMessengerPush({
          content: text,
          platform,
          tenantId,
        });
        switch (result.status) {
          case 'sent': {
            message.success(
              result.remaining === undefined
                ? t('messenger.push.sentToast', { platform: name })
                : t('messenger.push.sentWindowedToast', {
                    platform: name,
                    remaining: result.remaining,
                  }),
            );
            setContent('');
            break;
          }
          case 'queued': {
            message.info(t('messenger.push.queuedToast', { platform: name }));
            setContent('');
            break;
          }
          case 'unlinked': {
            message.warning(t('messenger.push.unlinkedToast', { platform: name }));
            break;
          }
          default: {
            message.warning(t('messenger.push.unavailableToast'));
          }
        }
        await windowSWR.mutate();
      } catch (error) {
        message.error(getMessengerErrorMessage(error, t, 'messenger.push.unavailableToast'));
      } finally {
        setSending(false);
      }
    };

    const renderWindowState = () => {
      if (windowSWR.error)
        return (
          <Flexbox horizontal align="center" gap={8}>
            <Text type="secondary">{t('messenger.push.loadFailed')}</Text>
            <Button
              icon={<Icon icon={RefreshCwIcon} />}
              size="small"
              onClick={() => windowSWR.mutate()}
            >
              {t('messenger.push.retry')}
            </Button>
          </Flexbox>
        );

      if (!status) return <Skeleton.Button active size="small" style={{ width: 220 }} />;

      if (status.deliverability === 'always')
        return (
          <Flexbox horizontal align="center" gap={8} wrap="wrap">
            <Tag color="success" icon={<Icon icon={CheckCircle2Icon} size="small" />}>
              {t('messenger.push.alwaysAvailable')}
            </Tag>
            <Text style={{ fontSize: 13 }} type="secondary">
              {t('messenger.push.alwaysAvailableHint', { platform: name })}
            </Text>
          </Flexbox>
        );

      if (!status.windowOpen)
        return (
          <Flexbox horizontal align="center" gap={8} wrap="wrap">
            <Tag icon={<Icon icon={MoonIcon} size="small" />}>
              {t('messenger.push.windowClosed')}
            </Tag>
            <Text style={{ fontSize: 13 }} type="secondary">
              {t('messenger.push.windowClosedHint', { platform: name })}
            </Text>
          </Flexbox>
        );

      const expiryValue =
        status.expiresInSeconds === null
          ? null
          : status.expiresInSeconds >= 3600
            ? `~${Math.round(status.expiresInSeconds / 3600)}h`
            : `~${Math.max(1, Math.round(status.expiresInSeconds / 60))}m`;

      return (
        <Flexbox horizontal align="center" gap={8} justify="space-between" wrap="wrap">
          <Flexbox horizontal align="center" gap={8}>
            <Tag color="success" icon={<Icon icon={CheckCircle2Icon} size="small" />}>
              {t('messenger.push.windowOpen')}
            </Tag>
            {expiryValue && (
              <Tag icon={<Icon icon={ClockIcon} size="small" />}>
                {t('messenger.push.expiresIn', { value: expiryValue })}
              </Tag>
            )}
          </Flexbox>
          <Flexbox horizontal align="center" gap={8}>
            <QuotaBars remaining={status.remaining} total={status.maxSends} />
            <span className={pushStyles.quotaText}>
              {status.remaining}
              <span> / {status.maxSends}</span>
            </span>
          </Flexbox>
        </Flexbox>
      );
    };

    return (
      <Flexbox gap={8}>
        <Flexbox gap={2}>
          <Text strong style={{ fontSize: 15 }}>
            {t('messenger.push.sectionTitle')}
          </Text>
          <Text style={{ fontSize: 13 }} type="secondary">
            {status?.deliverability === 'always' || (platform !== 'wechat' && !status)
              ? t('messenger.push.alwaysDescription', { platform: name })
              : t('messenger.push.windowedDescription', {
                  max: status?.maxSends ?? PUSH_WINDOW_DEFAULT_MAX_SENDS,
                  platform: name,
                })}
          </Text>
        </Flexbox>
        <Block className={styles.card}>
          <Flexbox gap={12}>
            <Flexbox horizontal align="center" gap={12}>
              <div className={styles.rowIcon}>
                <Icon icon={SendIcon} />
              </div>
              <Flexbox className={styles.rowIdentity} flex={1} gap={4}>
                <Text style={{ fontSize: 12 }} type="secondary">
                  {t('messenger.push.title')}
                </Text>
                {renderWindowState()}
              </Flexbox>
            </Flexbox>

            <Flexbox gap={12} style={{ paddingInlineStart: 48 }}>
              {!!status?.queued && (
                <Alert
                  showIcon
                  type="info"
                  message={t('messenger.push.queued', {
                    count: status.queued,
                    platform: name,
                  })}
                />
              )}

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

              <Flexbox horizontal align="center" gap={8}>
                <Input
                  disabled={sending || !canPush}
                  placeholder={t('messenger.push.placeholder', { platform: name })}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  onPressEnter={handleSend}
                />
                <Button
                  disabled={!content.trim() || !canPush}
                  icon={<Icon icon={SendIcon} />}
                  loading={sending}
                  type="primary"
                  onClick={handleSend}
                >
                  {t('messenger.push.send', { platform: name })}
                </Button>
              </Flexbox>
            </Flexbox>
          </Flexbox>
        </Block>
      </Flexbox>
    );
  },
);

MessengerPushSection.displayName = 'MessengerPushSection';
