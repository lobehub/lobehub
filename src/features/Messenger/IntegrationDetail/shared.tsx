'use client';

import { Block, Button, Flexbox, Icon, Skeleton, Tag, Text } from '@lobehub/ui';
import { App } from 'antd';
import { createStaticStyles } from 'antd-style';
import { ArrowLeftIcon, CheckCircle2Icon, Trash2Icon, UserIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { messengerService } from '@/services/messenger';

import AgentSelect from '../AgentSelect';
import { type MessengerPlatform, PlatformAvatar } from '../constants';
import { getMessengerErrorMessage, type MessengerTranslationKey } from '../i18n';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  backButton: css`
    cursor: pointer;

    display: inline-flex;
    gap: 6px;
    align-items: center;

    color: ${cssVar.colorTextSecondary};

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  card: css`
    padding: 16px;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadius};
  `,
  emptyRow: css`
    padding-block: 32px;
    padding-inline: 16px;
    border: 1px dashed ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadius};

    color: ${cssVar.colorTextSecondary};
    text-align: center;
  `,
  rowIcon: css`
    display: flex;
    align-items: center;
    justify-content: center;

    width: 36px;
    height: 36px;
    border-radius: 8px;

    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
}));

export interface ConnectionRowProps {
  action?: ReactNode;
  children?: ReactNode;
  icon: ReactNode;
  label: string;
  name: string;
  status: 'connected' | 'pending';
}

export const ConnectionRow = memo<ConnectionRowProps>(
  ({ action, children, icon, label, name, status }) => {
    const { t } = useTranslation('messenger');

    return (
      <Block className={styles.card}>
        <Flexbox gap={12}>
          <Flexbox horizontal align="center" gap={12}>
            <div className={styles.rowIcon}>{icon}</div>
            <Flexbox flex={1} gap={2}>
              <Text style={{ fontSize: 12 }} type="secondary">
                {label}
              </Text>
              <Text strong>{name}</Text>
            </Flexbox>
            {status === 'connected' ? (
              <Tag color="success" icon={<Icon icon={CheckCircle2Icon} size="small" />}>
                {t('messenger.detail.connections.connected')}
              </Tag>
            ) : (
              <Tag color="warning">{t('messenger.detail.connections.pending')}</Tag>
            )}
            {action}
          </Flexbox>
          {children && <Flexbox style={{ paddingInlineStart: 48 }}>{children}</Flexbox>}
        </Flexbox>
      </Block>
    );
  },
);
ConnectionRow.displayName = 'MessengerConnectionRow';

const ConnectionsSkeleton = memo<{ withNestedContent?: boolean }>(
  ({ withNestedContent = false }) => (
    <Flexbox gap={12}>
      {Array.from({ length: 2 }).map((_, index) => (
        <Block className={styles.card} key={index}>
          <Flexbox gap={12}>
            <Flexbox horizontal align="center" gap={12}>
              <Skeleton.Avatar active shape={'square'} size={36} />
              <Flexbox flex={1} gap={6}>
                <Skeleton.Button active size={'small'} style={{ width: 56 }} />
                <Skeleton.Button active style={{ height: 18, width: '40%' }} />
              </Flexbox>
              <Skeleton.Button active size={'small'} style={{ width: 72 }} />
              <Skeleton.Button active size={'small'} style={{ width: 84 }} />
            </Flexbox>
            {withNestedContent && (
              <Flexbox gap={6} style={{ paddingInlineStart: 48 }}>
                <Skeleton.Button active size={'small'} style={{ width: 72 }} />
                <Skeleton.Button active style={{ height: 32, width: '100%' }} />
              </Flexbox>
            )}
          </Flexbox>
        </Block>
      ))}
    </Flexbox>
  ),
);
ConnectionsSkeleton.displayName = 'MessengerConnectionsSkeleton';

export const IntegrationDetailSkeleton = memo<{ withNestedContent?: boolean }>(
  ({ withNestedContent = false }) => (
    <Flexbox gap={20}>
      <Flexbox horizontal align="center" gap={12}>
        <Skeleton.Button active size={'small'} style={{ width: 20 }} />
        <Skeleton.Button active style={{ height: 28, width: 96 }} />
      </Flexbox>

      <Block className={styles.card}>
        <Flexbox horizontal align="center" gap={16}>
          <Skeleton.Avatar active shape={'square'} size={48} />
          <Flexbox flex={1} gap={6}>
            <Skeleton.Button active size={'small'} style={{ width: 64 }} />
            <Skeleton active paragraph={{ rows: 1, width: '65%' }} title={false} />
          </Flexbox>
          <Skeleton.Button active style={{ height: 40, width: 120 }} />
        </Flexbox>
      </Block>

      <Flexbox gap={8}>
        <Skeleton.Button active size={'small'} style={{ width: 72 }} />
        <ConnectionsSkeleton withNestedContent={withNestedContent} />
      </Flexbox>
    </Flexbox>
  ),
);
IntegrationDetailSkeleton.displayName = 'MessengerIntegrationDetailSkeleton';

interface DetailLayoutProps {
  children?: ReactNode;
  hasConnections: boolean;
  headerAction: ReactNode;
  name: string;
  onBack: () => void;
  platform: MessengerPlatform;
}

export const DetailLayout = memo<DetailLayoutProps>(
  ({ children, headerAction, hasConnections, name, onBack, platform }) => {
    const { t } = useTranslation('messenger');

    return (
      <Flexbox gap={20}>
        <Flexbox horizontal align="center" gap={8}>
          <span className={styles.backButton} onClick={onBack}>
            <Icon icon={ArrowLeftIcon} size="small" />
          </span>
          <Text strong style={{ fontSize: 20 }}>
            {name}
          </Text>
        </Flexbox>

        <Block className={styles.card}>
          <Flexbox horizontal align="center" gap={16}>
            <PlatformAvatar platform={platform} size={48} />
            <Flexbox flex={1} gap={2}>
              <Text strong style={{ fontSize: 15 }}>
                {name}
              </Text>
              <Text style={{ fontSize: 13 }} type="secondary">
                {t(`messenger.list.${platform}.description` as any)}
              </Text>
            </Flexbox>
            {headerAction}
          </Flexbox>
        </Block>

        {hasConnections && (
          <Flexbox gap={8}>
            <Text strong style={{ fontSize: 15 }}>
              {t('messenger.detail.connections.title')}
            </Text>
            <Flexbox gap={12}>{children}</Flexbox>
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);
DetailLayout.displayName = 'MessengerDetailLayout';

interface UserLinkLike {
  activeAgentId: string | null;
  platformUserId: string;
  platformUsername: string | null;
}

export const formatUserHandle = (link: UserLinkLike): string =>
  link.platformUsername ? `@${link.platformUsername}` : `ID ${link.platformUserId}`;

interface UserAgentConnectionProps {
  extraLabel?: string;
  link: UserLinkLike;
  onSetActive: (agentId: string | null) => void;
  onUnlink: () => void;
}

export const UserAgentConnection = memo<UserAgentConnectionProps>(
  ({ extraLabel, link, onSetActive, onUnlink }) => {
    const { t } = useTranslation('messenger');
    const handle = formatUserHandle(link);
    const name = extraLabel ? `${handle} · ${extraLabel}` : handle;

    return (
      <ConnectionRow
        icon={<Icon icon={UserIcon} size="small" />}
        label={t('messenger.detail.connections.userLabel')}
        name={name}
        status="connected"
        action={
          <Button danger icon={<Icon icon={Trash2Icon} />} size="small" onClick={onUnlink}>
            {t('messenger.detail.disconnect')}
          </Button>
        }
      >
        <Flexbox gap={6}>
          <Text style={{ fontSize: 12 }} type="secondary">
            {t('messenger.activeAgent')}
          </Text>
          <AgentSelect
            placeholder={t('messenger.activeAgentPlaceholder')}
            value={link.activeAgentId ?? undefined}
            onChange={(agentId) => onSetActive((agentId ?? null) as string | null)}
          />
        </Flexbox>
      </ConnectionRow>
    );
  },
);
UserAgentConnection.displayName = 'MessengerUserAgentConnection';

export const useMessengerData = (platform: MessengerPlatform) => {
  const linksSWR = useSWR('messenger:listMyLinks', () => messengerService.listMyLinks());
  const installationsSWR = useSWR('messenger:listMyInstallations', () =>
    messengerService.listMyInstallations(),
  );

  const links = (linksSWR.data ?? []).filter((l) => l.platform === platform);
  const installations = (installationsSWR.data ?? []).filter((i) => i.platform === platform);
  const tenantNameByTenantId = new Map(installations.map((i) => [i.tenantId, i.tenantName]));
  const isInitialLoading = linksSWR.data === undefined || installationsSWR.data === undefined;

  return {
    installations,
    installationsMutate: installationsSWR.mutate,
    isInitialLoading,
    links,
    linksMutate: linksSWR.mutate,
    tenantNameByTenantId,
  };
};

interface UseLinkActionsArgs {
  installationsMutate: () => Promise<unknown>;
  linksMutate: () => Promise<unknown>;
  name: string;
  platform: MessengerPlatform;
}

export const useLinkActions = ({
  installationsMutate,
  linksMutate,
  name,
  platform,
}: UseLinkActionsArgs) => {
  const { t } = useTranslation('messenger');
  const { message, modal } = App.useApp();

  const handleSetActive = async (tenantId: string, agentId: string | null) => {
    try {
      await messengerService.setActiveAgent({
        agentId,
        platform,
        tenantId: tenantId || undefined,
      });
      await linksMutate();
      message.success(t('messenger.setActiveSuccess'));
    } catch (error) {
      message.error(getMessengerErrorMessage(error, t, 'messenger.setActiveFailed'));
    }
  };

  const handleUnlink = (tenantId: string) => {
    modal.confirm({
      content: t('messenger.unlinkConfirm', { platform: name }),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await messengerService.unlink({ platform, tenantId: tenantId || undefined });
          await linksMutate();
          message.success(t('messenger.unlinkSuccess'));
        } catch (error) {
          message.error(getMessengerErrorMessage(error, t, 'messenger.unlinkFailed'));
        }
      },
      title: t('messenger.unlinkTitle'),
    });
  };

  return { handleSetActive, handleUnlink };
};

export interface DisconnectInstallationCopy {
  /** Confirm modal body. */
  confirm: string;
  /** i18n key used for the toast fallback when the server doesn't return a known messenger error. */
  failedKey: MessengerTranslationKey;
  /** Toast text on success. */
  success: string;
  /** Confirm modal title. */
  title: string;
}

interface UseDisconnectInstallationArgs {
  installationsMutate: () => Promise<unknown>;
  linksMutate: () => Promise<unknown>;
}

/**
 * Disconnect-installation handler shared by Slack and Discord. The copy
 * diverges sharply between platforms — for Slack the operation freezes the
 * workspace's bot (token-gated dispatch); for Discord it only removes the
 * audit entry, since the bot stays in the guild until a server admin kicks
 * it. The platform passes already-localized strings + the `failedKey` so the
 * shared hook avoids embedding any platform-specific copy.
 */
export const useDisconnectInstallation = ({
  installationsMutate,
  linksMutate,
}: UseDisconnectInstallationArgs) => {
  const { t } = useTranslation('messenger');
  const { message, modal } = App.useApp();

  return (id: string, copy: DisconnectInstallationCopy) => {
    modal.confirm({
      content: copy.confirm,
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await messengerService.uninstallInstallation({ installationId: id });
          await installationsMutate();
          await linksMutate();
          message.success(copy.success);
        } catch (error) {
          message.error(getMessengerErrorMessage(error, t, copy.failedKey));
        }
      },
      title: copy.title,
    });
  };
};
