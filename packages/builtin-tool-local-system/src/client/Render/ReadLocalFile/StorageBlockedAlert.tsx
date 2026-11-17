'use client';

import { Alert, Button, Flexbox } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import { DRIVE_PATH } from '@/features/ResourceHome/paths';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

/** Copy the chat upload flow already shows for each `storage_block:<reason>`. */
const REASON_DESCRIPTION_KEYS = {
  billing_unavailable: 'upload.storageBlock.billingUnavailable',
  monthly_cap_reached: 'upload.storageBlock.monthlyCapReached',
  no_payment_method: 'upload.storageBlock.noPaymentMethod',
  overage_not_enabled: 'upload.storageBlock.overageNotEnabled',
  subscription_past_due: 'upload.storageBlock.subscriptionPastDue',
  subscription_unpaid: 'upload.storageBlock.subscriptionUnpaid',
  upgrade_required: 'upload.storageBlock.upgradeRequired',
} as const;

const getReasonDescriptionKey = (reason: string) => {
  const code = reason.replace(/^storage_block:/, '');
  return Object.hasOwn(REASON_DESCRIPTION_KEYS, code)
    ? REASON_DESCRIPTION_KEYS[code as keyof typeof REASON_DESCRIPTION_KEYS]
    : 'upload.storageLimitExceeded';
};

interface StorageBlockedAlertProps {
  /** The server's code, e.g. `storage_block:upgrade_required`. */
  reason: string;
}

/**
 * Shown on a readFile card whose image the user's file storage refused. Both
 * hosts that upload read images (the desktop app and `lh connect`) send them
 * without a workspace scope, so the actions open the personal pages: the drive
 * (every uploaded file, where space is freed) and the plans.
 */
const StorageBlockedAlert = ({ reason }: StorageBlockedAlertProps) => {
  const { t } = useTranslation(['tool', 'error']);
  const navigate = useWorkspaceAwareNavigate();

  return (
    <Alert
      showIcon
      title={t('localFiles.readFile.storageBlocked.title', { ns: 'tool' })}
      type={'warning'}
      description={
        // Actions sit under the text: beside it they squeeze the copy into a
        // narrow column in the chat's message width.
        <Flexbox gap={8}>
          <Flexbox gap={4}>
            <span>{t(getReasonDescriptionKey(reason), { ns: 'error' })}</span>
            <span>{t('localFiles.readFile.storageBlocked.desc', { ns: 'tool' })}</span>
          </Flexbox>
          <Flexbox horizontal gap={8}>
            <Button size={'small'} onClick={() => navigate(DRIVE_PATH, { escape: true })}>
              {t('upload.storageBlock.cleanupFiles', { ns: 'error' })}
            </Button>
            <Button
              size={'small'}
              type={'primary'}
              onClick={() => navigate('/settings/plans', { escape: true })}
            >
              {t('upload.storageBlock.viewPlans', { ns: 'error' })}
            </Button>
          </Flexbox>
        </Flexbox>
      }
    />
  );
};

export default StorageBlockedAlert;
