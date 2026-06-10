'use client';

import { Block, Button, Flexbox, Icon, Text } from '@lobehub/ui';
import { Select } from '@lobehub/ui/base-ui';
import { App } from 'antd';
import { createStaticStyles } from 'antd-style';
import { AlertTriangleIcon, CheckCircle2Icon, LinkIcon } from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { ProductLogo } from '@/components/Branding';
import { messengerService } from '@/services/messenger';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import AgentSelect from '../../AgentSelect';
import { type MessengerPlatform, PlatformBrandIcon } from '../../constants';
import { getMessengerErrorMessage } from '../../i18n';
import {
  buildMessengerScopeOptions,
  messengerScopeSelectClassNames,
  PERSONAL_SCOPE,
  resolvePersonalScopeLabel,
} from '../../scopeOptions';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  bubble: css`
    display: flex;
    align-items: center;
    justify-content: center;

    width: 64px;
    height: 64px;
    border-radius: 14px;

    background: ${cssVar.colorBgContainer};
    box-shadow:
      0 1px 2px rgb(0 0 0 / 6%),
      0 4px 12px rgb(0 0 0 / 4%);
  `,
  card: css`
    width: 100%;
    max-width: 440px;
  `,
  chainBubble: css`
    display: flex;
    align-items: center;
    justify-content: center;

    width: 24px;
    height: 24px;
    border-radius: 999px;

    color: ${cssVar.colorBgContainer};

    background: ${cssVar.colorTextBase};
  `,
  iconRow: css`
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: center;

    margin-block-end: 8px;
  `,
  infoRow: css`
    display: flex;
    gap: 16px;
    align-items: center;
    justify-content: space-between;

    padding-block: 10px;

    & + & {
      border-block-start: 1px solid ${cssVar.colorBorderSecondary};
    }
  `,
  infoValue: css`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  successBubble: css`
    color: #fff;
    background: #22c55e;
  `,
  warningBlock: css`
    padding-block: 12px;
    padding-inline: 16px;
    border-color: ${cssVar.colorWarningBorder};
    background: ${cssVar.colorWarningBg};
  `,
  warningIcon: css`
    flex-shrink: 0;
    color: ${cssVar.colorWarning};
  `,
}));

const ChainBubble = () => (
  <div className={styles.chainBubble}>
    <Icon icon={LinkIcon} size={16} />
  </div>
);

const PlatformBubble = ({ platform }: { platform: MessengerPlatform }) => (
  <div className={styles.bubble}>
    <PlatformBrandIcon platform={platform} size={platform === 'telegram' ? 36 : 32} />
  </div>
);

export const IconRow = memo<{ platform: MessengerPlatform }>(({ platform }) => (
  <div className={styles.iconRow}>
    <div className={styles.bubble}>
      <ProductLogo size={36} type="3d" />
    </div>
    <ChainBubble />
    <PlatformBubble platform={platform} />
  </div>
));
IconRow.displayName = 'MessengerVerifyIconRow';

export const Heading = memo<{ subtitle?: string; title: string }>(({ subtitle, title }) => (
  <Flexbox align="center" gap={12}>
    <Text
      align="center"
      as="h1"
      style={{ fontSize: 28, fontWeight: 700, lineHeight: 1.3, margin: 0 }}
    >
      {title}
    </Text>
    {subtitle && (
      <Text align="center" style={{ fontSize: 16, lineHeight: 1.5 }} type="secondary">
        {subtitle}
      </Text>
    )}
  </Flexbox>
));
Heading.displayName = 'MessengerVerifyHeading';

export interface InfoRow {
  label: string;
  value: string;
}

export interface ConfirmCardProps {
  blockingNotice?: {
    ctaHref: string;
    ctaLabel: string;
    description: string;
    title: string;
  };
  infoRows: InfoRow[];
  onSuccess: () => void;
  platform: MessengerPlatform;
  randomId: string;
  /** Current user's avatar, used to label the "personal" scope option. */
  userAvatar?: string | null;
}

export const ConfirmCard = memo<ConfirmCardProps>(
  ({ blockingNotice, infoRows, onSuccess, platform, randomId, userAvatar }) => {
    const { t } = useTranslation('messenger');
    const { message } = App.useApp();
    const enableWorkspaceScopes = useServerConfigStore(
      (s) =>
        serverConfigSelectors.enableBusinessFeatures(s) && s.featureFlags.enableWorkspace === true,
    );

    // First-level scope selector — personal plus every workspace the user
    // belongs to. Picking a scope just filters the agent list below; the
    // backend derives the binding's workspace from the chosen agent on confirm.
    const scopesSWR = useSWR(enableWorkspaceScopes ? 'messenger:bindingScopes' : null, () =>
      messengerService.listBindingScopes(),
    );
    const [scope, setScope] = useState<string>(PERSONAL_SCOPE);
    const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(undefined);
    const scopeWorkspaceId = scope === PERSONAL_SCOPE ? null : scope;
    const userDisplayName = useUserStore(userProfileSelectors.displayUserName);
    const userFullName = useUserStore(userProfileSelectors.fullName);

    useEffect(() => {
      if (enableWorkspaceScopes || scope === PERSONAL_SCOPE) return;
      setScope(PERSONAL_SCOPE);
      setSelectedAgentId(undefined);
    }, [enableWorkspaceScopes, scope]);

    // Scope-aware agent list. The SWR key matches AgentSelect's so the fetch is
    // shared (single request per scope) and stays in sync as the scope changes.
    const agentsSWR = useSWR(['messenger:agentsForBinding', scopeWorkspaceId], () =>
      messengerService.listAgentsForBinding(scopeWorkspaceId),
    );

    const [confirming, setConfirming] = useState(false);

    // Default-select the first agent (inbox is pinned to the top) once a scope's
    // list loads. Resetting selectedAgentId on scope change re-triggers this so
    // it re-defaults to the new scope's inbox.
    useEffect(() => {
      if (selectedAgentId || !agentsSWR.data?.length) return;
      setSelectedAgentId(agentsSWR.data[0].id);
    }, [agentsSWR.data, selectedAgentId]);

    // Mirror the Messenger connection card's scope picker: avatar + name per row.
    // Personal uses the user's avatar; workspaces use their own.
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

    // Personal-only deployments (OSS) return no workspaces — hide the scope
    // selector entirely so the experience is unchanged there.
    const hasWorkspaces = enableWorkspaceScopes && (scopesSWR.data?.length ?? 0) > 0;

    const isBlocked = !!blockingNotice;

    const handleConfirm = async () => {
      if (!selectedAgentId) return;
      setConfirming(true);
      try {
        await messengerService.confirmLink({ initialAgentId: selectedAgentId, randomId });
        onSuccess();
      } catch (error) {
        message.error(getMessengerErrorMessage(error, t, 'verify.error.generic'));
      } finally {
        setConfirming(false);
      }
    };

    return (
      <Flexbox align="center" className={styles.card} gap={32}>
        <IconRow platform={platform} />

        <Heading title={t('verify.confirm.title')} />

        <Block padding={4} style={{ width: '100%' }} variant={'outlined'}>
          <Flexbox paddingInline={16}>
            {infoRows.map((row) => (
              <div className={styles.infoRow} key={row.label}>
                <Text type="secondary">{row.label}</Text>
                <Text strong className={styles.infoValue} title={row.value}>
                  {row.value}
                </Text>
              </div>
            ))}
          </Flexbox>
        </Block>

        {blockingNotice && (
          <Block className={styles.warningBlock} style={{ width: '100%' }} variant={'outlined'}>
            <Flexbox horizontal gap={12}>
              <Icon className={styles.warningIcon} icon={AlertTriangleIcon} size={20} />
              <Flexbox gap={8} style={{ flex: 1 }}>
                <Text strong>{blockingNotice.title}</Text>
                <Text style={{ fontSize: 13 }} type="secondary">
                  {blockingNotice.description}
                </Text>
                <Button block href={blockingNotice.ctaHref} type="default">
                  {blockingNotice.ctaLabel}
                </Button>
              </Flexbox>
            </Flexbox>
          </Block>
        )}

        {!isBlocked && (
          <Flexbox gap={16} style={{ width: '100%' }}>
            {hasWorkspaces && (
              <Flexbox gap={8}>
                <Text strong>{t('messenger.scope')}</Text>
                <Select
                  classNames={messengerScopeSelectClassNames}
                  options={scopeOptions}
                  value={scope}
                  onChange={(next) => {
                    setScope((next as string | null) ?? PERSONAL_SCOPE);
                    // Re-default to the new scope's inbox agent.
                    setSelectedAgentId(undefined);
                  }}
                />
              </Flexbox>
            )}
            <Flexbox gap={8}>
              <Text strong>{t('verify.confirm.defaultAgent')}</Text>
              {agentsSWR.data?.length === 0 ? (
                <Text type="warning">{t('verify.confirm.noAgents')}</Text>
              ) : (
                <AgentSelect
                  placeholder={t('verify.confirm.defaultAgentPlaceholder')}
                  value={selectedAgentId}
                  workspaceId={scopeWorkspaceId}
                  onChange={setSelectedAgentId}
                />
              )}
              <Text style={{ fontSize: 12 }} type="secondary">
                {t('verify.confirm.defaultAgentHint')}
              </Text>
            </Flexbox>
          </Flexbox>
        )}

        <Button
          block
          disabled={isBlocked || !selectedAgentId}
          loading={confirming}
          size="large"
          type="primary"
          onClick={handleConfirm}
        >
          {t('verify.confirm.cta')}
        </Button>
      </Flexbox>
    );
  },
);
ConfirmCard.displayName = 'MessengerVerifyConfirmCard';

export interface SuccessCardProps {
  /** Pre-built deep link back to the bot. When omitted, the CTA is hidden. */
  openBotUrl?: string | null;
  platformLabel: string;
}

export const SuccessCard = memo<SuccessCardProps>(({ openBotUrl, platformLabel }) => {
  const { t } = useTranslation('messenger');

  return (
    <Flexbox align="center" className={styles.card} gap={24}>
      <div className={styles.iconRow}>
        <div className={`${styles.bubble} ${styles.successBubble}`}>
          <Icon icon={CheckCircle2Icon} size={32} />
        </div>
      </div>
      <Heading
        subtitle={t('verify.success.description', { platform: platformLabel })}
        title={t('verify.success.title')}
      />
      {openBotUrl && (
        <Button block href={openBotUrl} size="large" target="_blank" type="primary">
          {t('verify.success.openBot', { platform: platformLabel })}
        </Button>
      )}
    </Flexbox>
  );
});
SuccessCard.displayName = 'MessengerVerifySuccessCard';

export interface PeekedToken {
  linkedToEmail?: string | null;
  platform: MessengerPlatform;
  platformUserId: string;
  platformUsername?: string | null;
  tenantId?: string | null;
  tenantName?: string | null;
}

export interface ExistingLink {
  platform: string;
  platformUserId?: string;
  platformUsername?: string | null;
  tenantId?: string | null;
}

export interface PlatformMeta {
  appId?: string;
  botUsername?: string;
  id: string;
  name: string;
}
