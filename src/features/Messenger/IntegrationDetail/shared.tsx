'use client';

import { Block, Flexbox, Icon, Skeleton, Tag, Text } from '@lobehub/ui';
import { Button, confirmModal, Select } from '@lobehub/ui/base-ui';
import { App } from 'antd';
import { createStaticStyles } from 'antd-style';
import { ArrowLeftIcon, CheckCircle2Icon, Trash2Icon, UserIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { usePermission } from '@/hooks/usePermission';
import { messengerKeys } from '@/libs/swr/keys';
import { messengerService } from '@/services/messenger';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import AgentSelect from '../AgentSelect';
import { type MessengerPlatform, PlatformAvatar } from '../constants';
import { getMessengerErrorMessage, type MessengerTranslationKey } from '../i18n';
import {
  buildMessengerScopeOptions,
  messengerScopeSelectClassNames,
  PERSONAL_SCOPE,
  resolvePersonalScopeLabel,
} from '../scopeOptions';
import CommandsSection from './CommandsSection';

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
  rowIdentity: css`
    min-width: 0;
  `,
}));

export interface ConnectionRowProps {
  action?: ReactNode;
  children?: ReactNode;
  icon: ReactNode;
  label: string;
  name: string;
  nameTooltip?: string;
  status: 'connected' | 'pending';
}

export const ConnectionRow = memo<ConnectionRowProps>(
  ({ action, children, icon, label, name, nameTooltip, status }) => {
    const { t } = useTranslation('messenger');

    return (
      <Block className={styles.card}>
        <Flexbox gap={12}>
          <Flexbox horizontal align="center" gap={12}>
            <div className={styles.rowIcon}>{icon}</div>
            <Flexbox className={styles.rowIdentity} flex={1} gap={2}>
              <Text style={{ fontSize: 12 }} type="secondary">
                {label}
              </Text>
              <Text strong ellipsis={{ tooltip: nameTooltip ?? true }}>
                {name}
              </Text>
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
  /** Standalone sections (own title + card) rendered between the connections
   *  section and the commands section. */
  extraSections?: ReactNode;
  hasConnections: boolean;
  headerAction: ReactNode;
  name: string;
  onBack: () => void;
  platform: MessengerPlatform;
  sectionTitle?: ReactNode;
}

export const DetailLayout = memo<DetailLayoutProps>(
  ({
    children,
    extraSections,
    headerAction,
    hasConnections,
    name,
    onBack,
    platform,
    sectionTitle,
  }) => {
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
              {sectionTitle ?? t('messenger.detail.connections.title')}
            </Text>
            <Flexbox gap={12}>{children}</Flexbox>
          </Flexbox>
        )}

        {extraSections}

        <CommandsSection platform={platform} />
      </Flexbox>
    );
  },
);
DetailLayout.displayName = 'MessengerDetailLayout';

interface UserLinkLike {
  activeAgentId: string | null;
  platformUserId: string;
  platformUsername: string | null;
  /** Active scope of this link: a workspace id, or null for personal. */
  workspaceId: string | null;
}

export const formatUserHandle = (link: UserLinkLike): string =>
  link.platformUsername ? `@${link.platformUsername}` : `ID ${link.platformUserId}`;

interface UserAgentConnectionProps {
  extraLabel?: string;
  link: UserLinkLike;
  onSetActive: (agentId: string | null) => Promise<boolean>;
  onUnlink: () => void;
}

export const UserAgentConnection = memo<UserAgentConnectionProps>(
  ({ extraLabel, link, onSetActive, onUnlink }) => {
    const { t } = useTranslation('messenger');
    const { allowed: canEdit } = usePermission('edit_own_content');
    const enableWorkspaceScopes = useServerConfigStore(
      (s) =>
        serverConfigSelectors.enableBusinessFeatures(s) && s.featureFlags.enableWorkspace === true,
    );
    const handle = formatUserHandle(link);
    const hasReadableHandle = Boolean(link.platformUsername);
    const name = extraLabel
      ? hasReadableHandle
        ? `${handle} · ${extraLabel}`
        : extraLabel
      : handle;
    const nameTooltip = extraLabel && !hasReadableHandle ? handle : undefined;

    // First-level "scope" selector — personal plus every workspace the user
    // belongs to. The bot is a single shared bot; which LobeHub context a
    // conversation runs in is the active agent's scope, so picking a scope just
    // filters the agent list below. The active scope is persisted server-side
    // only when an agent is chosen (it derives the workspace from the agent).
    // `PERSONAL_SCOPE` is the sentinel for personal (null).
    const scopesSWR = useSWR(enableWorkspaceScopes ? messengerKeys.bindingScopes() : null, () =>
      messengerService.listBindingScopes(),
    );
    const [scope, setScope] = useState<string>(
      enableWorkspaceScopes ? (link.workspaceId ?? PERSONAL_SCOPE) : PERSONAL_SCOPE,
    );
    const userAvatar = useUserStore(userProfileSelectors.userAvatar);
    const userDisplayName = useUserStore(userProfileSelectors.displayUserName);
    const userFullName = useUserStore(userProfileSelectors.fullName);

    // Mirror the Agent Transfer scope picker: each row is an avatar + name.
    // Personal uses the user's avatar; workspaces use their own avatar.
    const scopeOptions = useMemo(() => {
      const personalLabel = resolvePersonalScopeLabel({
        fallbackLabel: userDisplayName || t('messenger.scopePersonal'),
        fullName: userFullName,
      });

      return buildMessengerScopeOptions({
        personalAvatar: userAvatar,
        personalLabel,
        personalTagLabel: t('messenger.scopePersonalTag', { defaultValue: 'personal' }),
        workspaces: scopesSWR.data,
      });
    }, [scopesSWR.data, t, userAvatar, userDisplayName, userFullName]);

    const scopeWorkspaceId = scope === PERSONAL_SCOPE ? null : scope;
    const linkIsActiveScope = scopeWorkspaceId === (link.workspaceId ?? null);

    useEffect(() => {
      if (enableWorkspaceScopes || scope === PERSONAL_SCOPE) return;
      setScope(PERSONAL_SCOPE);
    }, [enableWorkspaceScopes, scope]);

    // Optimistic selection for the currently-selected scope. Persisting the
    // active agent does a server round-trip plus a `linksMutate()` refetch, so
    // without this the dropdown only reflects the new pick once both finish.
    // `pending` mirrors the user's choice immediately and is cleared once the
    // link data catches up. Scoped by workspace so it only applies while the
    // scope it was made in is selected.
    const [pending, setPending] = useState<{
      agentId: string | null;
      workspaceId: string | null;
    } | null>(null);
    const pendingForScope = pending && pending.workspaceId === scopeWorkspaceId ? pending : null;

    useEffect(() => {
      if (!pending) return;
      if (
        (link.workspaceId ?? null) === pending.workspaceId &&
        (link.activeAgentId ?? null) === pending.agentId
      ) {
        setPending(null);
      }
    }, [link.workspaceId, link.activeAgentId, pending]);

    const activeAgentId = pendingForScope
      ? pendingForScope.agentId
      : linkIsActiveScope
        ? (link.activeAgentId ?? null)
        : null;

    return (
      <ConnectionRow
        icon={<Icon icon={UserIcon} size="small" />}
        label={t('messenger.detail.connections.userLabel')}
        name={name}
        nameTooltip={nameTooltip}
        status="connected"
        action={
          <Button
            danger
            disabled={!canEdit}
            icon={<Icon icon={Trash2Icon} />}
            size="small"
            onClick={() => {
              if (!canEdit) return;
              onUnlink();
            }}
          >
            {t('messenger.detail.disconnect')}
          </Button>
        }
      >
        <Flexbox horizontal align="flex-end" gap={12}>
          <Flexbox flex={1} gap={6}>
            <Text style={{ fontSize: 12 }} type="secondary">
              {t('messenger.scope')}
            </Text>
            <Select
              classNames={messengerScopeSelectClassNames}
              disabled={!canEdit}
              options={scopeOptions}
              value={scope}
              onChange={(next) => setScope((next as string | null) ?? PERSONAL_SCOPE)}
            />
          </Flexbox>
          <Flexbox flex={1} gap={6}>
            <Text style={{ fontSize: 12 }} type="secondary">
              {t('messenger.activeAgent')}
            </Text>
            <AgentSelect
              // Default to the scope's inbox agent whenever the selected scope has
              // no active Agent. This also repairs historical agent-less links.
              defaultToInbox={canEdit && !pendingForScope && !activeAgentId}
              disabled={!canEdit}
              placeholder={t('messenger.activeAgentPlaceholder')}
              value={activeAgentId ?? undefined}
              workspaceId={scopeWorkspaceId}
              onChange={async (agentId) => {
                if (!canEdit) return;
                const next = (agentId ?? null) as string | null;
                // Reflect the pick immediately, then persist in the background.
                setPending({ agentId: next, workspaceId: scopeWorkspaceId });
                const ok = await onSetActive(next);
                // Roll back to the persisted value if the update failed.
                if (!ok) setPending(null);
              }}
            />
          </Flexbox>
        </Flexbox>
      </ConnectionRow>
    );
  },
);
UserAgentConnection.displayName = 'MessengerUserAgentConnection';

export const useMessengerData = (platform: MessengerPlatform) => {
  const linksSWR = useSWR(messengerKeys.listMyLinks(), () => messengerService.listMyLinks());
  const installationsSWR = useSWR(messengerKeys.listMyInstallations(), () =>
    messengerService.listMyInstallations(),
  );

  const links = (linksSWR.data ?? []).filter((l) => l.platform === platform);
  const installations = (installationsSWR.data ?? []).filter((i) => i.platform === platform);
  const tenantNameByTenantId = new Map(installations.map((i) => [i.tenantId, i.tenantName]));
  const isInitialLoading = linksSWR.data === undefined || installationsSWR.data === undefined;
  // A failed links / installations fetch leaves `data === undefined`, which the
  // callers otherwise read as a permanent skeleton — surface the error so the
  // detail renders a failure + Retry instead (ux Read §1.1).
  const error = linksSWR.error ?? installationsSWR.error;

  return {
    error,
    installations,
    installationsMutate: installationsSWR.mutate,
    isInitialLoading,
    links,
    linksMutate: linksSWR.mutate,
    mutate: () => {
      void linksSWR.mutate();
      void installationsSWR.mutate();
    },
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
  const { message } = App.useApp();
  const { allowed: canEdit } = usePermission('edit_own_content');

  // Returns whether the update succeeded so the caller can roll back its
  // optimistic selection on failure.
  const handleSetActive = async (tenantId: string, agentId: string | null): Promise<boolean> => {
    if (!canEdit) return false;

    try {
      await messengerService.setActiveAgent({
        agentId,
        platform,
        tenantId: tenantId || undefined,
      });
      await linksMutate();
      message.success(t('messenger.setActiveSuccess'));
      return true;
    } catch (error) {
      message.error(getMessengerErrorMessage(error, t, 'messenger.setActiveFailed'));
      return false;
    }
  };

  const handleUnlink = (tenantId: string) => {
    if (!canEdit) return;

    confirmModal({
      // WeChat links by scanning a QR code — it has no /start command, so the
      // generic "/start again" copy would point users at a dead end.
      content:
        platform === 'wechat'
          ? t('messenger.unlinkConfirmWechat')
          : t('messenger.unlinkConfirm', { platform: name }),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await messengerService.unlink({ platform, tenantId: tenantId || undefined });
          await Promise.all([linksMutate(), installationsMutate()]);
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
  const { message } = App.useApp();
  const { allowed: canEdit } = usePermission('edit_own_content');

  return (id: string, copy: DisconnectInstallationCopy) => {
    if (!canEdit) return;

    confirmModal({
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
