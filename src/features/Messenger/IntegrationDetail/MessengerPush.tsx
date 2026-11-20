'use client';

import { Alert, Block, Button, Flexbox, Icon, Input, Select, Text, toast } from '@lobehub/ui';
import { SendIcon } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { messengerActions, messengerSelectors, useMessengerStore } from '@/store/messenger';

import type { MessengerPlatform } from '../constants';
import { getMessengerErrorMessage, getMessengerQueuedToast } from '../i18n';
import { MessengerPushWindowState } from './MessengerPushWindowState';
import { styles } from './shared';

const PUSH_WINDOW_DEFAULT_MAX_SENDS = 10;

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

    const windowSync = messengerActions.useFetchPushWindow({ platform, tenantId });
    // Live status, never restored from disk: undefined until the server answers.
    const status = useMessengerStore(messengerSelectors.pushWindow({ platform, tenantId }));

    const canPush = status?.deliverability === 'always' ? status.linked : !!status?.windowOpen;

    const handleSend = async () => {
      const text = content.trim();
      if (!text || sending || !canPush) return;

      setSending(true);
      try {
        const result = await messengerActions.sendPush({
          content: text,
          platform,
          tenantId,
        });
        switch (result.status) {
          case 'sent': {
            toast.success(
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
            toast.info(getMessengerQueuedToast(t, name, result.reason));
            setContent('');
            break;
          }
          case 'unlinked': {
            toast.warning(t('messenger.push.unlinkedToast', { platform: name }));
            break;
          }
          default: {
            toast.warning(t('messenger.push.unavailableToast'));
          }
        }
      } catch (error) {
        toast.error(getMessengerErrorMessage(error, t, 'messenger.push.unavailableToast'));
      } finally {
        setSending(false);
      }
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
                <MessengerPushWindowState
                  error={windowSync.error}
                  name={name}
                  status={status}
                  onRetry={() => {
                    void windowSync.revalidate();
                  }}
                />
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
