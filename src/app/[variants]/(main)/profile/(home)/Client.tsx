'use client';

import { LoadingOutlined } from '@ant-design/icons';
import { Button, Divider, Input, Skeleton, Spin, Typography, Upload } from 'antd';
import { AnimatePresence, motion } from 'framer-motion';
import {
  CSSProperties,
  ChangeEvent,
  ReactNode,
  memo,
  useCallback,
  useEffect,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { notification } from '@/components/AntdStaticMethods';
import { fetchErrorNotification } from '@/components/Error/fetchErrorNotification';
import { enableAuth } from '@/const/auth';
import UserAvatar from '@/features/User/UserAvatar';
import { requestPasswordReset } from '@/libs/better-auth/auth-client';
import { useUserStore } from '@/store/user';
import { authSelectors, userProfileSelectors } from '@/store/user/selectors';
import { imageToBase64 } from '@/utils/imageToBase64';
import { createUploadImageHandler } from '@/utils/uploadFIle';

import SSOProvidersList from './features/SSOProvidersList';

interface ProfileRowProps {
  action?: ReactNode;
  children: ReactNode;
  label: string;
  mobile?: boolean;
}

const rowStyle: CSSProperties = {
  minHeight: 48,
  padding: '16px 0',
};

const labelStyle: CSSProperties = {
  flexShrink: 0,
  width: 160,
};

type EditStatus = 'idle' | 'editing' | 'saving';

const ProfileRow = memo<ProfileRowProps>(({ label, children, action, mobile }) => {
  if (mobile) {
    return (
      <Flexbox gap={12} style={rowStyle}>
        <Flexbox align="center" horizontal justify="space-between">
          <Typography.Text strong>{label}</Typography.Text>
          {action}
        </Flexbox>
        <Flexbox>{children}</Flexbox>
      </Flexbox>
    );
  }

  return (
    <Flexbox align="center" gap={24} horizontal justify="space-between" style={rowStyle}>
      <Flexbox align="center" gap={24} horizontal style={{ flex: 1 }}>
        <Typography.Text style={labelStyle}>{label}</Typography.Text>
        <Flexbox style={{ flex: 1 }}>{children}</Flexbox>
      </Flexbox>
      {action && <Flexbox>{action}</Flexbox>}
    </Flexbox>
  );
});

const AvatarRow = memo<{ mobile?: boolean }>(({ mobile }) => {
  const { t } = useTranslation('auth');
  const isLogin = useUserStore(authSelectors.isLogin);
  const updateAvatar = useUserStore((s) => s.updateAvatar);
  const [uploading, setUploading] = useState(false);

  const handleUploadAvatar = useCallback(
    createUploadImageHandler(async (avatar) => {
      try {
        setUploading(true);
        const img = new Image();
        img.src = avatar;

        await new Promise((resolve, reject) => {
          img.addEventListener('load', resolve);
          img.addEventListener('error', reject);
        });

        const webpBase64 = imageToBase64({ img, size: 256 });
        await updateAvatar(webpBase64);
        setUploading(false);
      } catch (error) {
        console.error('Failed to upload avatar:', error);
        setUploading(false);

        fetchErrorNotification.error({
          errorMessage: error instanceof Error ? error.message : String(error),
          status: 500,
        });
      }
    }),
    [updateAvatar],
  );

  const canUpload = !enableAuth || isLogin;

  const avatarContent = canUpload ? (
    <Spin indicator={<LoadingOutlined spin />} spinning={uploading}>
      <Upload beforeUpload={handleUploadAvatar} itemRender={() => void 0} maxCount={1}>
        <UserAvatar clickable size={40} />
      </Upload>
    </Spin>
  ) : (
    <UserAvatar size={40} />
  );

  const updateAction = canUpload ? (
    <Upload beforeUpload={handleUploadAvatar} itemRender={() => void 0} maxCount={1}>
      <Typography.Text style={{ cursor: 'pointer', fontSize: 13 }}>
        {t('profile.updateAvatar')}
      </Typography.Text>
    </Upload>
  ) : null;

  if (mobile) {
    return (
      <Flexbox gap={12} style={rowStyle}>
        <Flexbox align="center" horizontal justify="space-between">
          <Typography.Text strong>{t('profile.avatar')}</Typography.Text>
          {updateAction}
        </Flexbox>
        <Flexbox>{avatarContent}</Flexbox>
      </Flexbox>
    );
  }

  return (
    <Flexbox align="center" gap={24} horizontal justify="space-between" style={rowStyle}>
      <Flexbox align="center" gap={24} horizontal style={{ flex: 1 }}>
        <Typography.Text style={labelStyle}>{t('profile.avatar')}</Typography.Text>
        <Flexbox style={{ flex: 1 }}>{avatarContent}</Flexbox>
      </Flexbox>
      {updateAction}
    </Flexbox>
  );
});

const FullNameRow = memo<{ mobile?: boolean }>(({ mobile }) => {
  const { t } = useTranslation('auth');
  const fullName = useUserStore(userProfileSelectors.fullName);
  const updateFullName = useUserStore((s) => s.updateFullName);
  const [status, setStatus] = useState<EditStatus>('idle');
  const [editValue, setEditValue] = useState('');

  const isEditing = status === 'editing' || status === 'saving';
  const saving = status === 'saving';

  const handleStartEdit = () => {
    setEditValue(fullName || '');
    setStatus('editing');
  };

  const handleCancel = () => {
    setStatus('idle');
    setEditValue('');
  };

  const handleSave = useCallback(async () => {
    if (!editValue.trim()) return;

    try {
      setStatus('saving');
      await updateFullName(editValue.trim());
      setStatus('idle');
    } catch (error) {
      console.error('Failed to update fullName:', error);
      fetchErrorNotification.error({
        errorMessage: error instanceof Error ? error.message : String(error),
        status: 500,
      });
      setStatus('editing');
    }
  }, [editValue, updateFullName]);

  const editingContent = (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      initial={{ opacity: 0, y: -10 }}
      key="editing"
      transition={{ duration: 0.2 }}
    >
      <Flexbox gap={12}>
        {!mobile && <Typography.Text strong>{t('profile.fullNameInputHint')}</Typography.Text>}
        <Input
          autoFocus
          onChange={(e) => setEditValue(e.target.value)}
          onPressEnter={handleSave}
          placeholder={t('profile.fullName')}
          value={editValue}
        />
        <Flexbox gap={8} horizontal justify="flex-end">
          <Button disabled={saving} onClick={handleCancel} size="small">
            {t('profile.cancel')}
          </Button>
          <Button loading={saving} onClick={handleSave} size="small" type="primary">
            {t('profile.save')}
          </Button>
        </Flexbox>
      </Flexbox>
    </motion.div>
  );

  const displayContent = (
    <motion.div
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      initial={{ opacity: 0 }}
      key="display"
      transition={{ duration: 0.2 }}
    >
      {mobile ? (
        <Typography.Text>{fullName || '--'}</Typography.Text>
      ) : (
        <Flexbox align="center" horizontal justify="space-between">
          <Typography.Text>{fullName || '--'}</Typography.Text>
          <Typography.Text onClick={handleStartEdit} style={{ cursor: 'pointer', fontSize: 13 }}>
            {t('profile.updateFullName')}
          </Typography.Text>
        </Flexbox>
      )}
    </motion.div>
  );

  if (mobile) {
    return (
      <Flexbox gap={12} style={rowStyle}>
        <Flexbox align="center" horizontal justify="space-between">
          <Typography.Text strong>{t('profile.fullName')}</Typography.Text>
          {!isEditing && (
            <Typography.Text onClick={handleStartEdit} style={{ cursor: 'pointer', fontSize: 13 }}>
              {t('profile.updateFullName')}
            </Typography.Text>
          )}
        </Flexbox>
        <AnimatePresence mode="wait">{isEditing ? editingContent : displayContent}</AnimatePresence>
      </Flexbox>
    );
  }

  return (
    <Flexbox gap={24} horizontal style={rowStyle}>
      <Typography.Text style={labelStyle}>{t('profile.fullName')}</Typography.Text>
      <Flexbox style={{ flex: 1 }}>
        <AnimatePresence mode="wait">{isEditing ? editingContent : displayContent}</AnimatePresence>
      </Flexbox>
    </Flexbox>
  );
});

const UsernameRow = memo<{ mobile?: boolean }>(({ mobile }) => {
  const { t } = useTranslation('auth');
  const username = useUserStore(userProfileSelectors.username);
  const updateUsername = useUserStore((s) => s.updateUsername);
  const [status, setStatus] = useState<EditStatus>('idle');
  const [editValue, setEditValue] = useState('');
  const [error, setError] = useState('');

  const isEditing = status === 'editing' || status === 'saving';
  const saving = status === 'saving';

  const usernameRegex = /^\w+$/;

  const handleStartEdit = () => {
    setEditValue(username || '');
    setError('');
    setStatus('editing');
  };

  const handleCancel = () => {
    setStatus('idle');
    setEditValue('');
    setError('');
  };

  const validateUsername = (value: string): string => {
    const trimmed = value.trim();
    if (!trimmed) return t('profile.usernameRequired');
    if (!usernameRegex.test(trimmed)) return t('profile.usernameRule');
    return '';
  };

  const handleSave = useCallback(async () => {
    const validationError = validateUsername(editValue);
    if (validationError) {
      setError(validationError);
      return;
    }

    try {
      setStatus('saving');
      setError('');
      await updateUsername(editValue.trim());
      setStatus('idle');
    } catch (err: any) {
      console.error('Failed to update username:', err);
      // Handle duplicate username error
      if (err?.data?.code === 'CONFLICT' || err?.message === 'USERNAME_TAKEN') {
        setError(t('profile.usernameDuplicate'));
      } else {
        setError(t('profile.usernameUpdateFailed'));
      }
      setStatus('editing');
    }
  }, [editValue, updateUsername, t]);

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setEditValue(value);

    if (!value.trim()) {
      setError('');
      return;
    }

    if (!usernameRegex.test(value)) {
      setError(t('profile.usernameRule'));
      return;
    }

    setError('');
  };

  const editingContent = (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      initial={{ opacity: 0, y: -10 }}
      key="editing"
      transition={{ duration: 0.2 }}
    >
      <Flexbox gap={12}>
        {!mobile && <Typography.Text strong>{t('profile.usernameInputHint')}</Typography.Text>}
        <Input
          autoFocus
          onChange={handleInputChange}
          onPressEnter={handleSave}
          placeholder={t('profile.usernamePlaceholder')}
          status={error ? 'error' : undefined}
          value={editValue}
        />
        {error && (
          <Typography.Text style={{ fontSize: 12 }} type="danger">
            {error}
          </Typography.Text>
        )}
        <Flexbox gap={8} horizontal justify="flex-end">
          <Button disabled={saving} onClick={handleCancel} size="small">
            {t('profile.cancel')}
          </Button>
          <Button loading={saving} onClick={handleSave} size="small" type="primary">
            {t('profile.save')}
          </Button>
        </Flexbox>
      </Flexbox>
    </motion.div>
  );

  const displayContent = (
    <motion.div
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      initial={{ opacity: 0 }}
      key="display"
      transition={{ duration: 0.2 }}
    >
      {mobile ? (
        <Typography.Text>{username || '--'}</Typography.Text>
      ) : (
        <Flexbox align="center" horizontal justify="space-between">
          <Typography.Text>{username || '--'}</Typography.Text>
          <Typography.Text onClick={handleStartEdit} style={{ cursor: 'pointer', fontSize: 13 }}>
            {t('profile.updateUsername')}
          </Typography.Text>
        </Flexbox>
      )}
    </motion.div>
  );

  if (mobile) {
    return (
      <Flexbox gap={12} style={rowStyle}>
        <Flexbox align="center" horizontal justify="space-between">
          <Typography.Text strong>{t('profile.username')}</Typography.Text>
          {!isEditing && (
            <Typography.Text onClick={handleStartEdit} style={{ cursor: 'pointer', fontSize: 13 }}>
              {t('profile.updateUsername')}
            </Typography.Text>
          )}
        </Flexbox>
        <AnimatePresence mode="wait">{isEditing ? editingContent : displayContent}</AnimatePresence>
      </Flexbox>
    );
  }

  return (
    <Flexbox gap={24} horizontal style={rowStyle}>
      <Typography.Text style={labelStyle}>{t('profile.username')}</Typography.Text>
      <Flexbox style={{ flex: 1 }}>
        <AnimatePresence mode="wait">{isEditing ? editingContent : displayContent}</AnimatePresence>
      </Flexbox>
    </Flexbox>
  );
});

const PasswordRow = memo<{ mobile?: boolean }>(({ mobile }) => {
  const { t } = useTranslation('auth');
  const userProfile = useUserStore(userProfileSelectors.userProfile);
  const hasPasswordAccount = useUserStore(authSelectors.hasPasswordAccount);
  const [sending, setSending] = useState(false);

  const handleChangePassword = useCallback(async () => {
    if (!userProfile?.email) return;

    try {
      setSending(true);
      await requestPasswordReset({
        email: userProfile.email,
        redirectTo: `/reset-password?email=${encodeURIComponent(userProfile.email)}`,
      });
      notification.success({
        message: t('profile.resetPasswordSent'),
      });
    } catch (error) {
      console.error('Failed to send reset password email:', error);
      notification.error({
        message: t('profile.resetPasswordError'),
      });
    } finally {
      setSending(false);
    }
  }, [userProfile?.email, t]);

  return (
    <ProfileRow
      action={
        <Typography.Text
          onClick={sending ? undefined : handleChangePassword}
          style={{
            cursor: sending ? 'default' : 'pointer',
            fontSize: 13,
            opacity: sending ? 0.5 : 1,
          }}
        >
          {hasPasswordAccount ? t('profile.changePassword') : t('profile.setPassword')}
        </Typography.Text>
      }
      label={t('profile.password')}
      mobile={mobile}
    >
      <Typography.Text>{hasPasswordAccount ? '••••••' : '--'}</Typography.Text>
    </ProfileRow>
  );
});

const Client = memo<{ mobile?: boolean }>(({ mobile }) => {
  const [isLoginWithNextAuth, isLoginWithBetterAuth] = useUserStore((s) => [
    authSelectors.isLoginWithNextAuth(s),
    authSelectors.isLoginWithBetterAuth(s),
  ]);
  const [userProfile, isUserLoaded] = useUserStore((s) => [
    userProfileSelectors.userProfile(s),
    s.isLoaded,
  ]);
  const isLoadedAuthProviders = useUserStore(authSelectors.isLoadedAuthProviders);
  const fetchAuthProviders = useUserStore((s) => s.fetchAuthProviders);

  const isLoginWithAuth = isLoginWithNextAuth || isLoginWithBetterAuth;
  const isLoading = !isUserLoaded || (isLoginWithAuth && !isLoadedAuthProviders);

  useEffect(() => {
    if (isLoginWithAuth) {
      fetchAuthProviders();
    }
  }, [isLoginWithAuth, fetchAuthProviders]);

  const { t } = useTranslation('auth');

  if (isLoading)
    return (
      <Skeleton
        active
        paragraph={{ rows: 6 }}
        style={{ padding: mobile ? 16 : undefined }}
        title={false}
      />
    );

  return (
    <Flexbox gap={0} paddingInline={mobile ? 16 : 0}>
      <Typography.Title level={4} style={{ marginBottom: 32 }}>
        {t('profile.title')}
      </Typography.Title>

      <Divider style={{ marginBlock: 0 }} />

      {/* Avatar Row - Editable */}
      <AvatarRow mobile={mobile} />

      <Divider style={{ margin: 0 }} />

      {/* Full Name Row - Editable */}
      <FullNameRow mobile={mobile} />

      <Divider style={{ margin: 0 }} />

      {/* Username Row - Editable */}
      <UsernameRow mobile={mobile} />

      <Divider style={{ margin: 0 }} />

      {/* Password Row - For Better Auth users to change or set password */}
      {isLoginWithBetterAuth && (
        <>
          <PasswordRow mobile={mobile} />
          <Divider style={{ margin: 0 }} />
        </>
      )}

      {/* Email Row - Read Only */}
      {isLoginWithAuth && userProfile?.email && (
        <>
          <ProfileRow label={t('profile.email')} mobile={mobile}>
            <Typography.Text>{userProfile.email}</Typography.Text>
          </ProfileRow>
          <Divider style={{ margin: 0 }} />
        </>
      )}

      {/* SSO Providers Row */}
      {isLoginWithAuth && (
        <ProfileRow label={t('profile.sso.providers')} mobile={mobile}>
          <SSOProvidersList />
        </ProfileRow>
      )}
    </Flexbox>
  );
});

export default Client;
