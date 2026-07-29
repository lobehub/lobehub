'use client';

import { Alert, Block, Flexbox, Icon, Input, Skeleton, Tag, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { App } from 'antd';
import { createStaticStyles } from 'antd-style';
import { CheckCircle2Icon, ClockIcon, MoonIcon, RefreshCwIcon, SendIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { messengerKeys } from '@/libs/swr/keys';
import { messengerService } from '@/services/messenger';

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
QuotaBars.displayName = 'MessengerWechatQuotaBars';

/**
 * "Message Push" section on the WeChat integration detail page.
 *
 * WeChat only lets the bot deliver messages inside a send window opened by the
 * user's own inbound message (10 sends / 24h). The section header condenses
 * that protocol constraint into its description, and the card makes the live
 * state visible — current window state, remaining quota, queued backlog — with
 * a self-serve test send so the capability can be verified without leaving the
 * page.
 */
const WechatPushSection = memo(() => {
  const { t } = useTranslation('messenger');
  const { message } = App.useApp();
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);

  const windowSWR = useSWR(
    messengerKeys.pushWindow('wechat'),
    () => messengerService.getMessengerPushWindow('wechat'),
    {
      refreshInterval: PUSH_WINDOW_REFRESH_INTERVAL,
      refreshWhenHidden: false,
      refreshWhenOffline: false,
    },
  );
  const status = windowSWR.data;

  // The send affordance is gated on an open window: pushing outside it cannot
  // be delivered now anyway, and the state line already tells the user how to
  // open it (message the bot in WeChat). Queueing stays a backend concern for
  // server-side callers; the self-serve UI never lets the user send into a
  // closed window.
  const canPush = !!status?.windowOpen;

  const handleSend = async () => {
    const text = content.trim();
    if (!text || sending || !canPush) return;

    setSending(true);
    try {
      const result = await messengerService.sendMessengerPush({
        content: text,
        platform: 'wechat',
      });
      switch (result.status) {
        case 'sent': {
          message.success(
            t('messenger.wechat.push.sentToast', { remaining: result.remaining ?? 0 }),
          );
          setContent('');
          break;
        }
        case 'queued': {
          message.info(t('messenger.wechat.push.queuedToast'));
          setContent('');
          break;
        }
        case 'unlinked': {
          message.warning(t('messenger.wechat.push.unlinkedToast'));
          break;
        }
        default: {
          message.warning(t('messenger.wechat.push.unavailableToast'));
        }
      }
      await windowSWR.mutate();
    } catch (error) {
      message.error(getMessengerErrorMessage(error, t, 'messenger.wechat.push.unavailableToast'));
    } finally {
      setSending(false);
    }
  };

  const renderWindowState = () => {
    if (windowSWR.error)
      return (
        <Flexbox horizontal align="center" gap={8}>
          <Text type="secondary">{t('messenger.wechat.push.loadFailed')}</Text>
          <Button
            icon={<Icon icon={RefreshCwIcon} />}
            size="small"
            onClick={() => windowSWR.mutate()}
          >
            {t('messenger.wechat.retry')}
          </Button>
        </Flexbox>
      );

    if (!status) return <Skeleton.Button active size="small" style={{ width: 220 }} />;

    if (!status.windowOpen)
      return (
        <Flexbox horizontal align="center" gap={8} wrap="wrap">
          <Tag icon={<Icon icon={MoonIcon} size="small" />}>
            {t('messenger.wechat.push.windowClosed')}
          </Tag>
          <Text style={{ fontSize: 13 }} type="secondary">
            {t('messenger.wechat.push.windowClosedHint')}
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
            {t('messenger.wechat.push.windowOpen')}
          </Tag>
          {expiryValue && (
            <Tag icon={<Icon icon={ClockIcon} size="small" />}>
              {t('messenger.wechat.push.expiresIn', { value: expiryValue })}
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
          {t('messenger.wechat.push.sectionTitle')}
        </Text>
        <Text style={{ fontSize: 13 }} type="secondary">
          {t('messenger.wechat.push.description', {
            max: status?.maxSends ?? PUSH_WINDOW_DEFAULT_MAX_SENDS,
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
                {t('messenger.wechat.push.title')}
              </Text>
              {renderWindowState()}
            </Flexbox>
          </Flexbox>

          <Flexbox gap={12} style={{ paddingInlineStart: 48 }}>
            {!!status?.queued && (
              <Alert
                showIcon
                message={t('messenger.wechat.push.queued', { count: status.queued })}
                type="info"
              />
            )}

            <Flexbox horizontal align="center" gap={8}>
              <Input
                disabled={sending || !canPush}
                placeholder={t('messenger.wechat.push.placeholder')}
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
                {t('messenger.wechat.push.send')}
              </Button>
            </Flexbox>
          </Flexbox>
        </Flexbox>
      </Block>
    </Flexbox>
  );
});

WechatPushSection.displayName = 'MessengerWechatPushSection';

export default WechatPushSection;
