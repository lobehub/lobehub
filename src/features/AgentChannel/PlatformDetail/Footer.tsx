'use client';

import { Alert, Button, Flexbox, Tag } from '@lobehub/ui';
import { type FormInstance, useWatch } from '@lobehub/ui/form';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { RefreshCw, Trash2 } from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { useAppOrigin } from '@/hooks/useAppOrigin';
import type { SerializedPlatformDefinition } from '@/server/services/bot/platforms/types';

import type { ChannelFormValues, CurrentConfig, TestResult } from './index';

/**
 * The tint stays, the outline goes. The soft Alert draws its outline as an inset box-shadow, not a
 * border, so that is what has to be cleared.
 */
const NOTICE_STYLE = { boxShadow: 'none' } as const;

const styles = stylex.create({
  actionBar: {
    alignItems: 'center',
    display: 'flex',
    justifyContent: 'space-between',
    paddingBlockStart: 16,
  },
  bottom: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    maxWidth: 1024,
    width: '100%',
  },
  notices: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    marginBlockStart: { ':empty': 0, 'default': 8 },
    maxWidth: 1024,
    width: '100%',
  },
  resultDetail: {
    color: cssVar.colorTextTertiary,
    fontFamily: 'monospace',
    fontSize: 12,
    wordBreak: 'break-all',
  },
  webhookBox: {
    backgroundColor: cssVar.colorFillQuaternary,
    borderColor: cssVar.colorBorder,
    borderRadius: cssVar.borderRadius,
    borderStyle: 'solid',
    borderWidth: 1,
    color: cssVar.colorTextSecondary,
    flexGrow: 1,
    flexShrink: 1,
    fontFamily: 'monospace',
    fontSize: 13,
    height: cssVar.controlHeight,
    lineHeight: cssVar.controlHeight,
    overflow: 'hidden',
    paddingInline: 12,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

/**
 * Error body of a result banner: one readable sentence, with the raw platform
 * message folded behind a "show details" toggle so it stays available for
 * diagnosis without being dumped into the banner.
 */
const ResultDetail = memo<{ detail?: string; hint: string }>(({ detail, hint }) => {
  const { t } = useTranslation('agent');
  const [open, setOpen] = useState(false);
  if (!detail || detail === hint) return <>{hint}</>;
  return (
    <Flexbox align={'flex-start'} gap={4}>
      <span>{hint}</span>
      <Button size={'small'} type={'text'} onClick={() => setOpen((value) => !value)}>
        {open ? t('channel.resultDetail.hide') : t('channel.resultDetail.show')}
      </Button>
      {open && <span {...stylex.props(styles.resultDetail)}>{detail}</span>}
    </Flexbox>
  );
});

ResultDetail.displayName = 'ResultDetail';

interface FooterNoticesProps {
  connectResult?: TestResult;
  currentConfig?: CurrentConfig;
  form: FormInstance<ChannelFormValues>;
  hasConfig: boolean;
  platformDef: SerializedPlatformDefinition;
  saveResult?: TestResult;
  testResult?: TestResult;
}

/**
 * What just happened to the bot (saved, connected, failed) and what it still
 * needs. Rendered above the form: the form is long enough now that a notice
 * under it would be scrolled past, and a failed connection is the one thing
 * the person has to see.
 */
export const FooterNotices = memo<FooterNoticesProps>(
  ({ platformDef, currentConfig, form, hasConfig, connectResult, saveResult, testResult }) => {
    const { t } = useTranslation('agent');
    const platformId = platformDef.id;
    const settingsConnectionMode = useWatch(form, 'settings.connectionMode');

    const showWebhookUrl = platformDef.showWebhookUrl || settingsConnectionMode === 'webhook';

    // Strong reminder when an already-saved bot is missing the operator's
    // User ID. Without it, AI tools can't push notifications back to the
    // operator and the pairing approver identity is undefined. Skipped on
    // first-time config and on platforms whose schema doesn't expose
    // `userId` (e.g. WeChat, which auto-manages identity via QR).
    const hasUserIdField = useMemo(() => {
      const settings = platformDef.schema.find((f) => f.key === 'settings');
      return settings?.properties?.some((f) => f.key === 'userId') ?? false;
    }, [platformDef.schema]);
    const watchedUserId = useWatch(form, 'settings.userId');
    // `useWatch` returns `undefined` until the form hydrates from the
    // parent's `initialValues`. Fall back to the saved value only during
    // that pre-hydration window so we don't flash the alert for every
    // saved bot. Once the form has reported a value, trust the watched
    // value — including `undefined`, so "Reset to Default" (which clears
    // settings.userId) correctly re-surfaces the alert.
    const savedUserId = currentConfig?.settings?.userId;
    const [formHydrated, setFormHydrated] = useState(false);
    useEffect(() => {
      if (watchedUserId !== undefined) setFormHydrated(true);
    }, [watchedUserId]);
    const effectiveUserId = formHydrated ? watchedUserId : savedUserId;
    const userIdMissing =
      hasConfig &&
      hasUserIdField &&
      !(typeof effectiveUserId === 'string' && effectiveUserId.trim());

    return (
      <div {...stylex.props(styles.notices)}>
        {saveResult && (
          <Alert
            closable
            showIcon
            style={NOTICE_STYLE}
            title={saveResult.type === 'success' ? t('channel.saved') : t('channel.saveFailed')}
            type={saveResult.type}
            description={
              saveResult.type === 'error' ? (
                <ResultDetail
                  detail={saveResult.errorDetail}
                  hint={saveResult.hint || t('channel.saveFailedHint')}
                />
              ) : undefined
            }
          />
        )}

        {connectResult && (
          <Alert
            closable
            showIcon
            style={NOTICE_STYLE}
            type={connectResult.type}
            description={
              connectResult.type === 'error' ? (
                <ResultDetail
                  detail={connectResult.errorDetail}
                  hint={connectResult.hint || t('channel.connectFailedHint')}
                />
              ) : undefined
            }
            title={
              connectResult.title ||
              (connectResult.type === 'success'
                ? t('channel.connectSuccess')
                : t('channel.connectFailed'))
            }
          />
        )}

        {testResult && (
          <Alert
            closable
            showIcon
            style={NOTICE_STYLE}
            type={testResult.type}
            description={
              testResult.type === 'error' ? (
                <ResultDetail
                  detail={testResult.errorDetail}
                  hint={testResult.hint || t('channel.testFailedHint')}
                />
              ) : undefined
            }
            title={
              testResult.type === 'success' ? t('channel.testSuccess') : t('channel.testFailed')
            }
          />
        )}

        {userIdMissing && (
          <Alert
            closable
            showIcon
            description={t('channel.userIdMissingDesc')}
            message={t('channel.userIdMissingTitle')}
            style={NOTICE_STYLE}
            type="info"
          />
        )}

        {hasConfig && showWebhookUrl && platformId === 'qq' && (
          <Alert
            closable
            showIcon
            description={t('channel.qq.webhookMigrationDesc')}
            message={t('channel.qq.webhookMigrationTitle')}
            style={NOTICE_STYLE}
            type="info"
          />
        )}

        {hasConfig && showWebhookUrl && platformId === 'slack' && (
          <Alert
            closable
            showIcon
            description={t('channel.slack.webhookMigrationDesc')}
            message={t('channel.slack.webhookMigrationTitle')}
            style={NOTICE_STYLE}
            type="info"
          />
        )}

        {hasConfig && showWebhookUrl && (platformId === 'feishu' || platformId === 'lark') && (
          <Alert
            closable
            showIcon
            description={t('channel.feishu.webhookMigrationDesc')}
            message={t('channel.feishu.webhookMigrationTitle')}
            style={NOTICE_STYLE}
            type="info"
          />
        )}
      </div>
    );
  },
);

FooterNotices.displayName = 'ChannelFooterNotices';

interface FooterActionsProps {
  connecting: boolean;
  disabled?: boolean;
  form: FormInstance<ChannelFormValues>;
  hasConfig: boolean;
  /** The setup steps already offer the save, so the bar does not repeat it. */
  hideSave?: boolean;
  isDirty: boolean;
  onCopied: () => void;
  onDelete: () => void;
  onDiscard: () => void;
  onSave: () => void;
  onTestConnection: () => void;
  platformDef: SerializedPlatformDefinition;
  saving: boolean;
  testing: boolean;
  writeDisabled?: boolean;
}

/** The buttons that act on the form, and the endpoint URL a webhook bot hands to the platform. */
export const FooterActions = memo<FooterActionsProps>(
  ({
    platformDef,
    form,
    hasConfig,
    hideSave,
    isDirty,
    connecting,
    disabled,
    saving,
    testing,
    writeDisabled,
    onSave,
    onDelete,
    onDiscard,
    onTestConnection,
    onCopied,
  }) => {
    const { t } = useTranslation('agent');
    const origin = useAppOrigin();
    const platformId = platformDef.id;
    const applicationId = useWatch(form, 'applicationId');
    const settingsConnectionMode = useWatch(form, 'settings.connectionMode');
    const showWebhookUrl = platformDef.showWebhookUrl || settingsConnectionMode === 'webhook';

    const webhookUrl = applicationId
      ? `${origin}/api/agent/webhooks/${platformId}/${applicationId}`
      : `${origin}/api/agent/webhooks/${platformId}`;

    return (
      <div {...stylex.props(styles.bottom)}>
        <div {...stylex.props(styles.actionBar)}>
          {hasConfig ? (
            <Button
              danger
              disabled={disabled || saving || connecting}
              icon={<Trash2 size={16} />}
              onClick={onDelete}
            >
              {t('channel.removeChannel')}
            </Button>
          ) : (
            <div />
          )}
          <Flexbox horizontal gap={12}>
            {hasConfig && (
              <Button
                disabled={writeDisabled || saving || connecting}
                icon={<RefreshCw size={16} />}
                loading={testing}
                onClick={onTestConnection}
              >
                {t('channel.testConnection')}
              </Button>
            )}
            {isDirty && (
              <Button disabled={writeDisabled || saving || connecting} onClick={onDiscard}>
                {t('channel.discard')}
              </Button>
            )}
            {!hideSave && (
              <Button
                disabled={writeDisabled}
                loading={saving || connecting}
                type="primary"
                onClick={onSave}
              >
                {connecting
                  ? t('channel.connecting')
                  : t(hasConfig ? 'channel.save' : 'channel.saveAndConnect')}
              </Button>
            )}
          </Flexbox>
        </div>

        {hasConfig && showWebhookUrl && (
          <Flexbox gap={8}>
            <Flexbox horizontal align="center" gap={8}>
              <span style={{ fontWeight: 600 }}>{t('channel.endpointUrl')}</span>
              <Tag>{'Event Subscription URL'}</Tag>
            </Flexbox>
            <Flexbox horizontal gap={8}>
              <div {...stylex.props(styles.webhookBox)}>{webhookUrl}</div>
              <Button
                onClick={() => {
                  navigator.clipboard.writeText(webhookUrl);
                  onCopied();
                }}
              >
                {t('channel.copy')}
              </Button>
            </Flexbox>
            <Alert
              showIcon
              style={NOTICE_STYLE}
              type="info"
              message={
                <Trans<'channel.endpointUrlHint', 'agent'>
                  components={{ bold: <strong /> }}
                  i18nKey="channel.endpointUrlHint"
                  ns="agent"
                  values={{ fieldName: 'Event Subscription URL', name: platformDef.name }}
                />
              }
            />
          </Flexbox>
        )}
      </div>
    );
  },
);

FooterActions.displayName = 'ChannelFooterActions';
