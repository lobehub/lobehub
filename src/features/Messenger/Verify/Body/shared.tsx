'use client';

import { Block, Button, Flexbox, Icon, Text } from '@lobehub/ui';
import { App } from 'antd';
import { createStaticStyles } from 'antd-style';
import { AlertTriangleIcon, CheckCircle2Icon, LinkIcon } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { ProductLogo } from '@/components/Branding';
import { messengerService } from '@/services/messenger';

import AgentSelect from '../../AgentSelect';
import { type MessengerPlatform, PlatformBrandIcon } from '../../constants';
import { getMessengerErrorMessage } from '../../i18n';

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
  /** Email of the LobeHub account already bound to this IM identity, if any. */
  conflictEmail?: string;
  infoRows: InfoRow[];
  onSuccess: () => void;
  platform: MessengerPlatform;
  platformLabel: string;
  randomId: string;
  /** Fallback URL the conflict warning sends the user to so they can switch accounts. */
  signInUrl: string;
}

export const ConfirmCard = memo<ConfirmCardProps>(
  ({ conflictEmail, infoRows, onSuccess, platform, platformLabel, randomId, signInUrl }) => {
    const { t } = useTranslation('messenger');
    const { message } = App.useApp();

    const agentsSWR = useSWR('messenger:agentsForBinding', () =>
      messengerService.listAgentsForBinding(),
    );

    const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(undefined);
    const [confirming, setConfirming] = useState(false);

    // Default-select the first agent once loaded; user can change before confirming.
    useEffect(() => {
      if (selectedAgentId || !agentsSWR.data?.length) return;
      setSelectedAgentId(agentsSWR.data[0].id);
    }, [agentsSWR.data, selectedAgentId]);

    const hasConflict = !!conflictEmail;

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

        {hasConflict && (
          <Block className={styles.warningBlock} style={{ width: '100%' }} variant={'outlined'}>
            <Flexbox horizontal gap={12}>
              <Icon className={styles.warningIcon} icon={AlertTriangleIcon} size={20} />
              <Flexbox gap={8} style={{ flex: 1 }}>
                <Text strong>{t('verify.confirm.conflict.title')}</Text>
                <Text style={{ fontSize: 13 }} type="secondary">
                  {t('verify.confirm.conflict.description', {
                    email: conflictEmail,
                    platform: platformLabel,
                  })}
                </Text>
                <Button block href={signInUrl} type="default">
                  {t('verify.confirm.conflict.switchAccount')}
                </Button>
              </Flexbox>
            </Flexbox>
          </Block>
        )}

        {!hasConflict && (
          <Flexbox gap={8} style={{ width: '100%' }}>
            <Text strong>{t('verify.confirm.defaultAgent')}</Text>
            {agentsSWR.data?.length === 0 ? (
              <Text type="warning">{t('verify.confirm.noAgents')}</Text>
            ) : (
              <AgentSelect
                placeholder={t('verify.confirm.defaultAgentPlaceholder')}
                value={selectedAgentId}
                onChange={setSelectedAgentId}
              />
            )}
            <Text style={{ fontSize: 12 }} type="secondary">
              {t('verify.confirm.defaultAgentHint')}
            </Text>
          </Flexbox>
        )}

        <Button
          block
          disabled={hasConflict || !selectedAgentId}
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
  tenantId?: string | null;
}

export interface PlatformMeta {
  appId?: string;
  botUsername?: string;
  id: string;
  name: string;
}
