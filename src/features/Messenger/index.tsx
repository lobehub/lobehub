'use client';

import { SlackOutlined } from '@ant-design/icons';
import { SiTelegram } from '@icons-pack/react-simple-icons';
import { Block, Button, Flexbox, Icon, Modal, Skeleton, Tag, Text } from '@lobehub/ui';
import { App, QRCode, Tabs } from 'antd';
import { createStaticStyles } from 'antd-style';
import { CheckCircle2Icon, LinkIcon, Trash2Icon } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { messengerService } from '@/services/messenger';

import AgentSelect from './AgentSelect';

type MessengerPlatform = 'telegram' | 'slack';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    padding: 16px;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadius};
  `,
  emptyState: css`
    padding-block: 48px;
    padding-inline: 24px;
    border: 1px dashed ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadius};

    color: ${cssVar.colorTextSecondary};
    text-align: center;
  `,
  page: css`
    overflow-y: auto;
    flex: 1;
    padding: 24px;
  `,
  qrIconOverlay: css`
    pointer-events: none;

    position: absolute;
    z-index: 1;
    inset-block-start: 50%;
    inset-inline-start: 50%;
    transform: translate(-50%, -50%);

    display: flex;
    align-items: center;
    justify-content: center;

    width: 44px;
    height: 44px;
    padding: 8px;
    border: 3px solid ${cssVar.colorBgContainer};
    border-radius: 50%;

    color: #fff;
  `,
  qrWrap: css`
    position: relative;

    padding: 14px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 16px;

    background: ${cssVar.colorBgContainer};
  `,
  tabLabel: css`
    display: inline-flex;
    gap: 6px;
    align-items: center;
  `,
}));

const PLATFORM_LABELS: Record<MessengerPlatform, string> = {
  slack: 'Slack',
  telegram: 'Telegram',
};

const PLATFORM_ICONS: Record<MessengerPlatform, ReactNode> = {
  slack: <SlackOutlined style={{ color: '#4A154B' }} />,
  telegram: <SiTelegram color="#229ED9" size={16} />,
};

const PLATFORM_BRAND_COLOR: Record<MessengerPlatform, string> = {
  slack: '#4A154B',
  telegram: '#229ED9',
};

const PlatformBrandIcon = ({ platform }: { platform: MessengerPlatform }) => {
  if (platform === 'telegram') return <SiTelegram color="#fff" size={20} />;
  return <SlackOutlined style={{ color: '#fff', fontSize: 20 }} />;
};

const buildTelegramDeepLink = (botUsername: string): string =>
  `https://t.me/${botUsername.replace(/^@/, '')}?start=messenger`;

const MessengerSettings = memo(() => {
  const { t } = useTranslation('messenger');
  const { message, modal } = App.useApp();
  const [linkOpen, setLinkOpen] = useState(false);

  const platformsSWR = useSWR('messenger:availablePlatforms', () =>
    messengerService.availablePlatforms(),
  );
  const linksSWR = useSWR('messenger:listMyLinks', () => messengerService.listMyLinks());

  const platforms = platformsSWR.data ?? [];
  const links = linksSWR.data ?? [];
  const linksByPlatform = new Map(links.map((link) => [link.platform, link]));

  const isLoading = platformsSWR.isLoading || linksSWR.isLoading;

  const handleSetActive = async (platform: MessengerPlatform, agentId: string | null) => {
    try {
      await messengerService.setActiveAgent({ agentId, platform });
      await linksSWR.mutate();
      message.success(t('messenger.setActiveSuccess'));
    } catch (error: any) {
      message.error(error?.message ?? t('messenger.setActiveFailed'));
    }
  };

  const handleUnlink = (platform: MessengerPlatform) => {
    modal.confirm({
      content: t('messenger.unlinkConfirm', { platform: PLATFORM_LABELS[platform] }),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await messengerService.unlink({ platform });
          await linksSWR.mutate();
          message.success(t('messenger.unlinkSuccess'));
        } catch (error: any) {
          message.error(error?.message ?? t('messenger.unlinkFailed'));
        }
      },
      title: t('messenger.unlinkTitle'),
    });
  };

  return (
    <div className={styles.page}>
      <Flexbox gap={24} style={{ margin: '0 auto', maxWidth: 720 }}>
        <Flexbox gap={4}>
          <Text type="secondary">{t('messenger.subtitle')}</Text>
        </Flexbox>

        {isLoading ? (
          <Skeleton active paragraph={{ rows: 4 }} title={false} />
        ) : platforms.length === 0 ? (
          <div className={styles.emptyState}>{t('messenger.noPlatformsConfigured')}</div>
        ) : (
          <Flexbox gap={12}>
            {platforms.map((p) => {
              const platform = p.platform as MessengerPlatform;
              const link = linksByPlatform.get(platform);
              const label = PLATFORM_LABELS[platform] ?? platform;
              const activeAgentId = link?.activeAgentId ?? null;

              return (
                <Block className={styles.card} key={platform}>
                  <Flexbox gap={16}>
                    <Flexbox horizontal align="center" gap={12} justify="space-between">
                      <Flexbox horizontal align="center" gap={8}>
                        <Text strong style={{ fontSize: 16 }}>
                          {label}
                        </Text>
                        {link ? (
                          <Tag color="success" icon={<Icon icon={CheckCircle2Icon} size="small" />}>
                            {t('messenger.statusLinked')}
                          </Tag>
                        ) : (
                          <Tag color="default">{t('messenger.statusNotLinked')}</Tag>
                        )}
                      </Flexbox>
                      {link ? (
                        <Button
                          danger
                          icon={<Icon icon={Trash2Icon} />}
                          size="small"
                          onClick={() => handleUnlink(platform)}
                        >
                          {t('messenger.unlinkCta')}
                        </Button>
                      ) : (
                        <Button
                          icon={<Icon icon={LinkIcon} />}
                          size="small"
                          type="primary"
                          onClick={() => setLinkOpen(true)}
                        >
                          {t('messenger.linkCta')}
                        </Button>
                      )}
                    </Flexbox>

                    {link && (
                      <Flexbox gap={4}>
                        <Text type="secondary">
                          {t('messenger.linkedAccount', {
                            handle: link.platformUsername
                              ? `@${link.platformUsername}`
                              : `ID ${link.platformUserId}`,
                            platform: label,
                          })}
                        </Text>
                      </Flexbox>
                    )}

                    {link && (
                      <Flexbox gap={8}>
                        <Text strong>{t('messenger.activeAgent')}</Text>
                        <AgentSelect
                          placeholder={t('messenger.activeAgentPlaceholder')}
                          value={activeAgentId ?? undefined}
                          onChange={(agentId) =>
                            handleSetActive(platform, (agentId ?? null) as string | null)
                          }
                        />
                        {!activeAgentId && (
                          <Text style={{ fontSize: 12 }} type="secondary">
                            {t('messenger.activeAgentHintEmpty')}
                          </Text>
                        )}
                      </Flexbox>
                    )}
                  </Flexbox>
                </Block>
              );
            })}
            <Text style={{ fontSize: 12 }} type="secondary">
              {t('messenger.helpCommands')}
            </Text>
          </Flexbox>
        )}
      </Flexbox>

      <Modal
        footer={null}
        open={linkOpen}
        title={t('messenger.linkModal.title')}
        onCancel={() => setLinkOpen(false)}
      >
        <Tabs
          centered
          items={platforms.map((p) => {
            const platform = p.platform as MessengerPlatform;
            const platformLabel = PLATFORM_LABELS[platform] ?? platform;
            const isTelegram = platform === 'telegram';
            const deepLink =
              isTelegram && p.botUsername ? buildTelegramDeepLink(p.botUsername) : undefined;
            return {
              children: (
                <Flexbox align="center" gap={20} style={{ paddingBlock: 16 }}>
                  {deepLink ? (
                    <>
                      <div className={styles.qrWrap}>
                        <QRCode bordered={false} size={200} value={deepLink} />
                        <div
                          className={styles.qrIconOverlay}
                          style={{ background: PLATFORM_BRAND_COLOR[platform] }}
                        >
                          <PlatformBrandIcon platform={platform} />
                        </div>
                      </div>
                      <Flexbox align="center" gap={6}>
                        <Text strong style={{ fontSize: 18 }}>
                          {t('messenger.linkModal.continueIn', { platform: platformLabel })}
                        </Text>
                        <Text style={{ textAlign: 'center' }} type="secondary">
                          {t('messenger.linkModal.scanHint', { platform: platformLabel })}
                        </Text>
                      </Flexbox>
                      <Button block href={deepLink} size="large" target="_blank" type="primary">
                        {t('messenger.linkModal.openCta', { platform: platformLabel })}
                      </Button>
                    </>
                  ) : (
                    <>
                      <Icon icon={LinkIcon} size={36} />
                      <Text strong>
                        {t('messenger.linkModal.continueIn', { platform: platformLabel })}
                      </Text>
                      <Text type="warning">{t('messenger.linkModal.notConfigured')}</Text>
                    </>
                  )}
                </Flexbox>
              ),
              key: platform,
              label: (
                <span className={styles.tabLabel}>
                  {PLATFORM_ICONS[platform]}
                  {platformLabel}
                </span>
              ),
            };
          })}
        />
      </Modal>
    </div>
  );
});

MessengerSettings.displayName = 'MessengerSettings';

export default MessengerSettings;
