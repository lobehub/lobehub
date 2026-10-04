'use client';

import { Block, Flexbox, Icon } from '@lobehub/ui';
import { Alert, Button, QRCode, Spin, Text, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { InfoIcon, MessageCircleIcon, RefreshCwIcon } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { usePermission } from '@/hooks/usePermission';
import { messengerService } from '@/services/messenger';

import { getMessengerErrorMessage } from '../i18n';
import { MessengerPushSection } from './MessengerPush';
import {
  DetailLayout,
  IntegrationDetailSkeleton,
  useLinkActions,
  useMessengerData,
  UserAgentConnection,
} from './shared';

const POLL_INTERVAL_MS = 2000;
const QR_SIZE = 200;

const styles = createStaticStyles(({ css, cssVar }) => ({
  code: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 20px;
    font-weight: 600;
    letter-spacing: 0.08em;
  `,
  qrSlot: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: ${QR_SIZE + 20}px;
    height: ${QR_SIZE + 20}px;
    padding: 9px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorFillQuaternary};
  `,
  setup: css`
    align-items: center;

    padding-block: 32px;
    padding-inline: 20px;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadius};
  `,
  tips: css`
    max-width: 480px;
    font-size: ${cssVar.fontSize};
    text-align: center;
  `,
}));

interface LinqLinkSession {
  code: string;
  deepLink: { body?: string; imessage: string; number: string; sms: string };
  expiresAt: number;
  pollId: string;
}

type SetupState =
  | { stage: 'idle' }
  | { stage: 'loading' }
  | { message: string; stage: 'error' }
  // The link exists server-side; only the local refresh is pending / failed.
  // Never offer a new code from here — `createLinqLink` would answer CONFLICT.
  | { stage: 'linked' }
  | { message: string; stage: 'refreshError' }
  | { session: LinqLinkSession; stage: 'waiting' };

interface LinqLinkSetupProps {
  disabled?: boolean;
  onLinked: () => Promise<void>;
}

/**
 * Web-initiated link: show a one-time code and an `sms:` deep link prefilled
 * with it (as a QR code for desktop, as a button on the phone). The person
 * sends it from their own phone to the shared pool; the inbound sender becomes
 * the linked identity, and this view polls until the server sees it.
 */
const LinqLinkSetup = memo<LinqLinkSetupProps>(({ disabled, onLinked }) => {
  const { t } = useTranslation('messenger');
  const [state, setState] = useState<SetupState>({ stage: 'idle' });
  const aliveRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      stopPolling();
    };
  }, [stopPolling]);

  const finishLinked = useCallback(async () => {
    setState({ stage: 'linked' });
    try {
      await onLinked();
    } catch (error) {
      if (!aliveRef.current) return;
      setState({
        message: getMessengerErrorMessage(error, t, 'messenger.linq.error.refreshFailed'),
        stage: 'refreshError',
      });
    }
  }, [onLinked, t]);

  const start = useCallback(async () => {
    if (disabled) return;
    stopPolling();
    setState({ stage: 'loading' });

    try {
      const session = await messengerService.createLinqLink();
      if (!aliveRef.current) return;
      setState({ session, stage: 'waiting' });

      const poll = async (): Promise<void> => {
        if (!aliveRef.current) return;
        try {
          const result = await messengerService.pollLinqLink(session.pollId);
          if (!aliveRef.current) return;

          if (result.status === 'linked') {
            stopPolling();
            await finishLinked();
            return;
          }
          if (result.status === 'expired') {
            stopPolling();
            setState({ message: t('messenger.linq.code.expired'), stage: 'error' });
            return;
          }
          if (result.status === 'failed') {
            stopPolling();
            setState({
              message:
                result.reason === 'already_linked_to_other'
                  ? t('messenger.linq.error.alreadyLinkedToOther')
                  : t('messenger.linq.error.unlinkBeforeRelink'),
              stage: 'error',
            });
            return;
          }
          timerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
        } catch (error) {
          stopPolling();
          setState({
            message: getMessengerErrorMessage(error, t, 'messenger.linq.error.pollFailed'),
            stage: 'error',
          });
        }
      };

      timerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
    } catch (error) {
      setState({
        message: getMessengerErrorMessage(error, t, 'messenger.linq.error.codeUnavailable'),
        stage: 'error',
      });
    }
  }, [disabled, finishLinked, stopPolling, t]);

  return (
    <Block className={styles.setup}>
      <Flexbox align="center" gap={12}>
        {state.stage === 'idle' && (
          <Button
            disabled={disabled}
            icon={<Icon icon={MessageCircleIcon} />}
            type="primary"
            onClick={start}
          >
            {t('messenger.linq.connectCta')}
          </Button>
        )}
        {(state.stage === 'loading' || state.stage === 'linked') && <Spin size="large" />}
        {state.stage === 'waiting' && (
          <>
            <div className={styles.qrSlot}>
              <QRCode
                aria-label={t('messenger.linq.setupTitle')}
                bgColor="#fff"
                bordered={false}
                color="#000"
                size={QR_SIZE}
                value={state.session.deepLink.sms}
              />
            </div>
            <Text type="secondary">{t('messenger.linq.code.label')}</Text>
            <Text className={styles.code} data-testid="linq-link-code">
              {state.session.code}
            </Text>
            <Text type="secondary">
              {t('messenger.linq.code.sendTo', { number: state.session.deepLink.number })}
            </Text>
            <Button
              href={state.session.deepLink.sms}
              icon={<Icon icon={MessageCircleIcon} />}
              type="primary"
            >
              {t('messenger.linq.openMessages')}
            </Button>
            <Text type="secondary">
              {t('messenger.linq.code.expiresAt', {
                time: new Date(state.session.expiresAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                }),
              })}
            </Text>
            <Text type="secondary">{t('messenger.linq.code.waiting')}</Text>
          </>
        )}
        {state.stage === 'error' && (
          <Flexbox align="center" gap={12} width="100%">
            <Alert showIcon message={state.message} type="warning" />
            <Button
              disabled={disabled}
              icon={<Icon icon={RefreshCwIcon} />}
              type="primary"
              onClick={start}
            >
              {t('messenger.linq.retry')}
            </Button>
          </Flexbox>
        )}

        {state.stage === 'refreshError' && (
          <Flexbox align="center" gap={12} width="100%">
            <Alert showIcon message={state.message} type="warning" />
            <Button icon={<Icon icon={RefreshCwIcon} />} type="primary" onClick={finishLinked}>
              {t('messenger.linq.refresh')}
            </Button>
          </Flexbox>
        )}

        <Text className={styles.tips} type="secondary">
          <Icon icon={InfoIcon} style={{ marginInlineEnd: 4 }} />
          {t('messenger.linq.code.tip')}
        </Text>
      </Flexbox>
    </Block>
  );
});
LinqLinkSetup.displayName = 'MessengerLinqLinkSetup';

export { LinqLinkSetup };

interface LinqDetailProps {
  name: string;
  onBack: () => void;
}

const LinqDetail = memo<LinqDetailProps>(({ name, onBack }) => {
  const { t } = useTranslation('messenger');
  const { allowed: canCreate } = usePermission('create_content');
  const { allowed: canEdit } = usePermission('edit_own_content');
  const data = useMessengerData('linq');
  const { handleSetActive, handleUnlink } = useLinkActions({
    installationsMutate: data.installationsMutate,
    linksMutate: data.linksMutate,
    name,
    platform: 'linq',
  });

  if (data.error && data.isInitialLoading)
    return <AsyncError error={data.error} variant="block" onRetry={data.mutate} />;
  if (data.isInitialLoading) return <IntegrationDetailSkeleton withNestedContent />;

  const link = data.links[0];

  const handleLinked = async () => {
    await data.linksMutate();
    toast.success(t('messenger.linq.connected'));
  };

  return (
    <DetailLayout
      hasConnections
      extraSections={link ? <MessengerPushSection name={name} platform="linq" /> : undefined}
      headerAction={null}
      name={name}
      platform="linq"
      sectionTitle={link ? t('messenger.detail.connections.title') : t('messenger.linq.setupTitle')}
      onBack={onBack}
    >
      {link ? (
        <UserAgentConnection
          extraLabel={t('messenger.linq.accountLabel')}
          link={link}
          onSetActive={(agentId) => handleSetActive(link.tenantId, agentId)}
          onUnlink={() => handleUnlink(link.tenantId)}
        />
      ) : (
        <LinqLinkSetup disabled={!canCreate || !canEdit} onLinked={handleLinked} />
      )}
    </DetailLayout>
  );
});

LinqDetail.displayName = 'MessengerLinqDetail';

export default LinqDetail;
