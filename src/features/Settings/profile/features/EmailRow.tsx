'use client';

import { isDesktop } from '@lobechat/const';
import { Button, Flexbox, Icon, Input, Text, toast } from '@lobehub/ui';
import { ExternalLinkIcon } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import { useAppOrigin } from '@/hooks/useAppOrigin';
import { changeEmail } from '@/libs/better-auth/auth-client';
import { CHANGE_EMAIL_IN_USE_CODE } from '@/libs/better-auth/constants';
import { electronSystemService } from '@/services/electron/system';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import ProfileRow from './ProfileRow';

const EMAIL_REGEX = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

const EmailRow = () => {
  const { t } = useTranslation('auth');
  const email = useUserStore(userProfileSelectors.email);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  /** Shown under the input instead of a toast so the guidance stays visible while the user fixes it */
  const [error, setError] = useState('');
  const appOrigin = useAppOrigin();

  const handleStartEdit = () => {
    setEditValue('');
    setError('');
    setIsEditing(true);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditValue('');
    setError('');
  };

  const handleSave = useCallback(async () => {
    const trimmed = editValue.trim();
    if (!trimmed) return;

    if (!EMAIL_REGEX.test(trimmed)) {
      setError(t('profile.emailInvalid'));
      return;
    }

    // Better Auth rejects this with an untranslated "Email is the same" and no error code
    if (trimmed.toLowerCase() === email?.toLowerCase()) {
      setError(t('profile.emailSameAsCurrent'));
      return;
    }

    try {
      setSaving(true);
      setError('');
      const res = await changeEmail({ callbackURL: '/settings/profile', newEmail: trimmed });
      if (res.error) {
        if (res.error.code === CHANGE_EMAIL_IN_USE_CODE) {
          setError(t('profile.emailInUseHint', { email: trimmed }));
          return;
        }
        if (res.error.status === 429) {
          setError(t('profile.emailChangeTooMany'));
          return;
        }
        // Server messages are untranslated and technical; keep them in the console only
        console.error('Failed to change email:', res.error);
        setError(t('profile.emailChangeFailed'));
        return;
      }
      setIsEditing(false);
      toast.success(t('profile.emailChangeSuccess'));
    } catch (err) {
      console.error('Failed to change email:', err);
      setError(t('profile.emailChangeFailed'));
    } finally {
      setSaving(false);
    }
  }, [editValue, email, t]);

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
        <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
          <Input
            autoFocus
            aria-invalid={!!error}
            autoComplete="email"
            data-invalid={error ? '' : undefined}
            inputMode="email"
            placeholder={t('profile.emailPlaceholder')}
            size="small"
            style={{ flex: 1, minWidth: 0, width: '100%' }}
            type="email"
            value={editValue}
            variant="filled"
            onPressEnter={handleSave}
            onChange={(e) => {
              setEditValue(e.target.value);
              setError('');
            }}
          />
          {error && (
            <Text fontSize={12} role="alert" type="danger">
              {error}
            </Text>
          )}
        </Flexbox>
      ) : (
        <Text>{email || '--'}</Text>
      )}
    </ProfileRow>
  );
};

export default EmailRow;
