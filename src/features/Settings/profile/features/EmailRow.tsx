'use client';

import { isDesktop } from '@lobechat/const';
import { Flexbox, Icon, Input } from '@lobehub/ui';
import { Button, Text, toast } from '@lobehub/ui/base-ui';
import { ExternalLinkIcon } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import { useAppOrigin } from '@/hooks/useAppOrigin';
import { changeEmail } from '@/libs/better-auth/auth-client';
import { electronSystemService } from '@/services/electron/system';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';
import { saveToast } from '@/store/utils/saveToast';

import ProfileRow from './ProfileRow';

const EMAIL_REGEX = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

const EmailRow = () => {
  const { t } = useTranslation('auth');
  const email = useUserStore(userProfileSelectors.email);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const appOrigin = useAppOrigin();

  const handleStartEdit = () => {
    setEditValue('');
    setIsEditing(true);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditValue('');
  };

  const handleSave = useCallback(async () => {
    const trimmed = editValue.trim();
    if (!trimmed) return;

    if (!EMAIL_REGEX.test(trimmed)) {
      toast.error(t('profile.emailInvalid'));
      return;
    }

    try {
      setSaving(true);
      const res = await changeEmail({ callbackURL: '/settings/profile', newEmail: trimmed });
      if (res.error) {
        toast.error(res.error.message ?? res.error.statusText ?? t('profile.saveError'));
        return;
      }
      setIsEditing(false);
      toast.success(t('profile.emailChangeSuccess'));
    } catch (err) {
      console.error('Failed to change email:', err);
      saveToast(err, { retry: () => void handleSave(), title: t('profile.saveError') });
    } finally {
      setSaving(false);
    }
  }, [editValue, t]);

  // Desktop OIDC and Better Auth sessions are not bridged, so change-email can only
  // be completed on the web app.
  if (isDesktop)
    return (
      <ProfileRow
        anchor={'profile-email'}
        label={t('profile.email')}
        action={
          <Text
            style={{ cursor: 'pointer', fontSize: 13 }}
            onClick={() => {
              if (!appOrigin) return;
              void electronSystemService.openExternalLink(urlJoin(appOrigin, '/settings/profile'));
            }}
          >
            <Flexbox horizontal align={'center'} gap={4}>
              {t('profile.updateEmail')}
              <Icon icon={ExternalLinkIcon} size={12} />
            </Flexbox>
          </Text>
        }
      >
        <Text>{email || '--'}</Text>
      </ProfileRow>
    );

  return (
    <ProfileRow
      anchor={'profile-email'}
      label={t('profile.email')}
      action={
        isEditing ? (
          <Flexbox horizontal gap={8}>
            <Button disabled={saving} size="small" onClick={handleCancel}>
              {t('profile.cancel')}
            </Button>
            <Button loading={saving} size="small" type="primary" onClick={handleSave}>
              {t('profile.save')}
            </Button>
          </Flexbox>
        ) : (
          <Text style={{ cursor: 'pointer', fontSize: 13 }} onClick={handleStartEdit}>
            {t('profile.updateEmail')}
          </Text>
        )
      }
    >
      {isEditing ? (
        <Input
          autoFocus
          autoComplete="email"
          inputMode="email"
          placeholder={t('profile.emailPlaceholder')}
          size="small"
          style={{ flex: 1, minWidth: 0, width: '100%' }}
          type="email"
          value={editValue}
          variant="filled"
          onChange={(e) => setEditValue(e.target.value)}
          onPressEnter={handleSave}
        />
      ) : (
        <Text>{email || '--'}</Text>
      )}
    </ProfileRow>
  );
};

export default EmailRow;
