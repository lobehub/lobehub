'use client';

import { Alert, Button, Flexbox } from '@lobehub/ui';
import { type FormInstance, useWatch } from '@lobehub/ui/form';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, type Ref, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { SerializedPlatformDefinition } from '@/server/services/bot/platforms/types';

import type { ChannelFormValues, CurrentConfig, TestResult } from './index';

/** Anchor on the "Your account" section, so the missing-User-ID alert can jump to it. */
export const ACCOUNT_SECTION_ID = 'channel-section-account';

const styles = stylex.create({
  resultDetail: {
    color: cssVar.colorTextTertiary,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: 12,
    wordBreak: 'break-all',
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

interface StatusAlertsProps {
  connectResult?: TestResult;
  currentConfig?: CurrentConfig;
  form: FormInstance<ChannelFormValues>;
  hasConfig: boolean;
  platformDef: SerializedPlatformDefinition;
  ref?: Ref<HTMLDivElement>;
  saveResult?: TestResult;
  testResult?: TestResult;
}

/**
 * Everything the operator has to act on, at the top of the page: a failed save,
 * the bot's connection outcome, a test result, and setup still missing.
 * Success of a plain save is a toast, not a banner.
 */
const StatusAlerts = memo<StatusAlertsProps>(
  ({ connectResult, currentConfig, form, hasConfig, platformDef, ref, saveResult, testResult }) => {
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

    const webhookMigration =
      hasConfig && showWebhookUrl
        ? platformId === 'qq'
          ? 'qq'
          : platformId === 'slack'
            ? 'slack'
            : platformId === 'feishu' || platformId === 'lark'
              ? 'feishu'
              : undefined
        : undefined;

    const showSaveError = saveResult?.type === 'error';
    if (!showSaveError && !connectResult && !testResult && !userIdMissing && !webhookMigration)
      return null;

    return (
      <Flexbox gap={12} ref={ref} style={{ width: '100%' }}>
        {showSaveError && (
          <Alert
            closable
            showIcon
            title={t('channel.saveFailed')}
            type={'error'}
            description={
              <ResultDetail
                detail={saveResult.errorDetail}
                hint={saveResult.hint || t('channel.saveFailedHint')}
              />
            }
          />
        )}

        {connectResult && (
          <Alert
            closable
            showIcon
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
            showIcon
            description={t('channel.userIdMissingHint')}
            title={t('channel.userIdMissingTitle')}
            type="info"
            action={
              <Button
                size={'small'}
                onClick={() =>
                  document
                    .getElementById(ACCOUNT_SECTION_ID)
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }
              >
                {t('channel.userIdMissingAction')}
              </Button>
            }
          />
        )}

        {webhookMigration && (
          <Alert
            closable
            showIcon
            description={t(`channel.${webhookMigration}.webhookMigrationDesc`)}
            title={t(`channel.${webhookMigration}.webhookMigrationTitle`)}
            type="info"
          />
        )}
      </Flexbox>
    );
  },
);

StatusAlerts.displayName = 'ChannelStatusAlerts';

export default StatusAlerts;
