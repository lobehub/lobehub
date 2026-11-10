import { Alert } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import { isDesktop } from '@/const/version';
import { type RecorderErrorCode, useMeetingStore } from '@/store/meeting';

/**
 * What the user has to do about the microphone before a recording can start:
 * expect the browser prompt, unblock a denied permission, or connect a device.
 */
const PermissionNotice = () => {
  const { t } = useTranslation('meeting');
  const permission = useMeetingStore((s) => s.permission);
  const error = useMeetingStore((s) => s.recorder.error);

  const blocking: RecorderErrorCode | undefined =
    error === 'permission_denied' || permission === 'denied'
      ? 'permission_denied'
      : error === 'no_device' || error === 'not_supported'
        ? error
        : undefined;

  if (blocking === 'permission_denied')
    return (
      <Alert
        showIcon
        title={t('permission.denied.title')}
        type={'error'}
        description={t(
          isDesktop ? 'permission.denied.descriptionDesktop' : 'permission.denied.description',
        )}
      />
    );

  if (blocking === 'no_device')
    return (
      <Alert
        showIcon
        description={t('permission.noDevice.description')}
        title={t('permission.noDevice.title')}
        type={'warning'}
      />
    );

  if (blocking === 'not_supported')
    return (
      <Alert
        showIcon
        description={t('permission.notSupported.description')}
        title={t('permission.notSupported.title')}
        type={'warning'}
      />
    );

  if (permission !== 'granted')
    return (
      <Alert
        showIcon
        description={t('permission.prompt.description')}
        title={t('permission.prompt.title')}
        type={'info'}
      />
    );

  return null;
};

export default PermissionNotice;
