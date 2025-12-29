'use client';

import { LoadingOutlined } from '@ant-design/icons';
import { isDesktop } from '@lobechat/const';
import { Block, Button, Flexbox, Icon, Input, Skeleton, Tag, Text } from '@lobehub/ui';
import { Divider, Spin, Upload } from 'antd';
import { cssVar } from 'antd-style';
import { BriefcaseIcon } from 'lucide-react';
import { AnimatePresence, m as motion } from 'motion/react';
import {
  type CSSProperties,
  type ChangeEvent,
  type ReactNode,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import { INTEREST_AREAS } from '@/app/[variants]/onboarding/config';
import { notification } from '@/components/AntdStaticMethods';
import { fetchErrorNotification } from '@/components/Error/fetchErrorNotification';
import { enableAuth } from '@/const/auth';
import UserAvatar from '@/features/User/UserAvatar';
import { useServerConfigStore } from '@/store/serverConfig';
import { serverConfigSelectors } from '@/store/serverConfig/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors, userProfileSelectors } from '@/store/user/selectors';
import { imageToBase64 } from '@/utils/imageToBase64';
import { createUploadImageHandler } from '@/utils/uploadFIle';

import KlavisAuthorizationList from './features/KlavisAuthorizationList';
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

const ProfileRow = memo<ProfileRowProps>(({ label, children, action, mobile }) => {
  if (mobile) {
    return (
      <Flexbox gap={12} style={rowStyle}>
        <Flexbox align="center" horizontal justify="space-between">
          <Text strong>{label}</Text>
          {action}
        </Flexbox>
        <Flexbox>{children}</Flexbox>
      </Flexbox>
    );
  }

  return (
    <Flexbox align="center" gap={24} horizontal justify="space-between" style={rowStyle}>
      <Flexbox align="center" gap={24} horizontal style={{ flex: 1 }}>
        <Text style={labelStyle}>{label}</Text>
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
      <Text fontSize={13} style={{ cursor: 'pointer' }}>
        {t('profile.updateAvatar')}
      </Text>
    </Upload>
  ) : null;

  if (mobile) {
    return (
      <Flexbox gap={12} style={rowStyle}>
        <Flexbox align="center" horizontal justify="space-between">
          <Text strong>{t('profile.avatar')}</Text>
          {updateAction}
        </Flexbox>
        <Flexbox>{avatarContent}</Flexbox>
      </Flexbox>
    );
  }

  return (
    <Flexbox align="center" gap={24} horizontal justify="space-between" style={rowStyle}>
      <Flexbox align="center" gap={24} horizontal style={{ flex: 1 }}>
        <Text style={labelStyle}>{t('profile.avatar')}</Text>
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
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

  const handleStartEdit = () => {
    setEditValue(fullName || '');
    setIsEditing(true);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditValue('');
  };

  const handleSave = useCallback(async () => {
    if (!editValue.trim()) return;

    try {
      setSaving(true);
      await updateFullName(editValue.trim());
      setIsEditing(false);
    } catch (error) {
      console.error('Failed to update fullName:', error);
      fetchErrorNotification.error({
        errorMessage: error instanceof Error ? error.message : String(error),
        status: 500,
      });
    } finally {
      setSaving(false);
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
        {!mobile && <Text strong>{t('profile.fullNameInputHint')}</Text>}
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
        <Text>{fullName || '--'}</Text>
      ) : (
        <Flexbox align="center" horizontal justify="space-between">
          <Text>{fullName || '--'}</Text>
          <Text onClick={handleStartEdit} style={{ cursor: 'pointer', fontSize: 13 }}>
            {t('profile.updateFullName')}
          </Text>
        </Flexbox>
      )}
    </motion.div>
  );

  if (mobile) {
    return (
      <Flexbox gap={12} style={rowStyle}>
        <Flexbox align="center" horizontal justify="space-between">
          <Text strong>{t('profile.fullName')}</Text>
          {!isEditing && (
            <Text onClick={handleStartEdit} style={{ cursor: 'pointer', fontSize: 13 }}>
              {t('profile.updateFullName')}
            </Text>
          )}
        </Flexbox>
        <AnimatePresence mode="wait">{isEditing ? editingContent : displayContent}</AnimatePresence>
      </Flexbox>
    );
  }

  return (
    <Flexbox gap={24} horizontal style={rowStyle}>
      <Text style={labelStyle}>{t('profile.fullName')}</Text>
      <Flexbox style={{ flex: 1 }}>
        <AnimatePresence mode="wait">{isEditing ? editingContent : displayContent}</AnimatePresence>
      </Flexbox>
    </Flexbox>
  );
});

const InterestsRow = memo<{ mobile?: boolean }>(({ mobile }) => {
  const { t } = useTranslation('auth');
  const { t: tOnboarding } = useTranslation('onboarding');
  const interests = useUserStore(userProfileSelectors.interests);
  const updateInterests = useUserStore((s) => s.updateInterests);
  const [isEditing, setIsEditing] = useState(false);
  const [selectedInterests, setSelectedInterests] = useState<string[]>([]);
  const [customInput, setCustomInput] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [saving, setSaving] = useState(false);

  const areas = useMemo(
    () =>
      INTEREST_AREAS.map((area) => ({
        ...area,
        label: tOnboarding(`interests.area.${area.key}`),
      })),
    [tOnboarding],
  );

  const handleStartEdit = () => {
    setSelectedInterests([...interests]);
    setIsEditing(true);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setSelectedInterests([]);
    setCustomInput('');
    setShowCustomInput(false);
  };

  const toggleInterest = useCallback((label: string) => {
    setSelectedInterests((prev) =>
      prev.includes(label) ? prev.filter((i) => i !== label) : [...prev, label],
    );
  }, []);

  const handleAddCustom = useCallback(() => {
    const trimmed = customInput.trim();
    if (trimmed && !selectedInterests.includes(trimmed)) {
      setSelectedInterests((prev) => [...prev, trimmed]);
      setCustomInput('');
    }
  }, [customInput, selectedInterests]);

  const handleSave = useCallback(async () => {
    // Include custom input if has content
    const finalInterests = [...selectedInterests];
    const trimmedCustom = customInput.trim();
    if (showCustomInput && trimmedCustom && !finalInterests.includes(trimmedCustom)) {
      finalInterests.push(trimmedCustom);
    }

    // Deduplicate
    const uniqueInterests = [...new Set(finalInterests)];

    try {
      setSaving(true);
      await updateInterests(uniqueInterests);
      setIsEditing(false);
      setSelectedInterests([]);
      setCustomInput('');
      setShowCustomInput(false);
    } catch (error) {
      console.error('Failed to update interests:', error);
      fetchErrorNotification.error({
        errorMessage: error instanceof Error ? error.message : String(error),
        status: 500,
      });
    } finally {
      setSaving(false);
    }
  }, [selectedInterests, customInput, showCustomInput, updateInterests]);

  const editingContent = (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      initial={{ opacity: 0, y: -10 }}
      key="editing"
      transition={{ duration: 0.2 }}
    >
      <Flexbox gap={12}>
        <Flexbox align="center" gap={8} horizontal wrap="wrap">
          {areas.map((item) => {
            const isSelected = selectedInterests.includes(item.label);
            return (
              <Block
                clickable
                gap={8}
                horizontal
                key={item.key}
                onClick={() => toggleInterest(item.label)}
                padding={8}
                style={
                  isSelected
                    ? {
                        background: cssVar.colorFillSecondary,
                        borderColor: cssVar.colorFillSecondary,
                      }
                    : {}
                }
                variant="outlined"
              >
                <Icon color={cssVar.colorTextSecondary} icon={item.icon} size={14} />
                <Text fontSize={13} weight={500}>
                  {item.label}
                </Text>
              </Block>
            );
          })}
          {/* Render custom interests with same Block style but no icon */}
          {selectedInterests
            .filter((i) => !areas.some((a) => a.label === i))
            .map((interest) => (
              <Block
                clickable
                key={interest}
                onClick={() => toggleInterest(interest)}
                padding={8}
                style={{
                  background: cssVar.colorFillSecondary,
                  borderColor: cssVar.colorFillSecondary,
                }}
                variant="outlined"
              >
                <Text fontSize={13} weight={500}>
                  {interest}
                </Text>
              </Block>
            ))}
          <Block
            clickable
            gap={8}
            horizontal
            onClick={() => setShowCustomInput(!showCustomInput)}
            padding={8}
            style={
              showCustomInput
                ? { background: cssVar.colorFillSecondary, borderColor: cssVar.colorFillSecondary }
                : {}
            }
            variant="outlined"
          >
            <Icon color={cssVar.colorTextSecondary} icon={BriefcaseIcon} size={14} />
            <Text fontSize={13} weight={500}>
              {tOnboarding('interests.area.other')}
            </Text>
          </Block>
        </Flexbox>
        {showCustomInput && (
          <Input
            onChange={(e) => setCustomInput(e.target.value)}
            onPressEnter={handleAddCustom}
            placeholder={tOnboarding('interests.placeholder')}
            size="small"
            style={{ width: 200 }}
            value={customInput}
          />
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
        interests.length > 0 ? (
          <Flexbox gap={8} horizontal style={{ flexWrap: 'wrap' }}>
            {interests.map((interest) => (
              <Tag key={interest}>{interest}</Tag>
            ))}
          </Flexbox>
        ) : (
          <Text>--</Text>
        )
      ) : (
        <Flexbox align="center" horizontal justify="space-between">
          {interests.length > 0 ? (
            <Flexbox gap={8} horizontal style={{ flexWrap: 'wrap' }}>
              {interests.map((interest) => (
                <Tag key={interest}>{interest}</Tag>
              ))}
            </Flexbox>
          ) : (
            <Text>--</Text>
          )}
          <Text onClick={handleStartEdit} style={{ cursor: 'pointer', fontSize: 13 }}>
            {t('profile.updateInterests')}
          </Text>
        </Flexbox>
      )}
    </motion.div>
  );

  if (mobile) {
    return (
      <Flexbox gap={12} style={rowStyle}>
        <Flexbox align="center" horizontal justify="space-between">
          <Text strong>{t('profile.interests')}</Text>
          {!isEditing && (
            <Text onClick={handleStartEdit} style={{ cursor: 'pointer', fontSize: 13 }}>
              {t('profile.updateInterests')}
            </Text>
          )}
        </Flexbox>
        <AnimatePresence mode="wait">{isEditing ? editingContent : displayContent}</AnimatePresence>
      </Flexbox>
    );
  }

  return (
    <Flexbox gap={24} horizontal style={rowStyle}>
      <Text style={labelStyle}>{t('profile.interests')}</Text>
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
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const usernameRegex = /^\w+$/;

  const handleStartEdit = () => {
    setEditValue(username || '');
    setError('');
    setIsEditing(true);
  };

  const handleCancel = () => {
    setIsEditing(false);
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
      setSaving(true);
      setError('');
      await updateUsername(editValue.trim());
      setIsEditing(false);
    } catch (err: any) {
      console.error('Failed to update username:', err);
      // Handle duplicate username error
      if (err?.data?.code === 'CONFLICT' || err?.message === 'USERNAME_TAKEN') {
        setError(t('profile.usernameDuplicate'));
      } else {
        setError(t('profile.usernameUpdateFailed'));
      }
    } finally {
      setSaving(false);
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
        {!mobile && <Text strong>{t('profile.usernameInputHint')}</Text>}
        <Input
          autoFocus
          onChange={handleInputChange}
          onPressEnter={handleSave}
          placeholder={t('profile.usernamePlaceholder')}
          status={error ? 'error' : undefined}
          value={editValue}
        />
        {error && (
          <Text style={{ fontSize: 12 }} type="danger">
            {error}
          </Text>
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
        <Text>{username || '--'}</Text>
      ) : (
        <Flexbox align="center" horizontal justify="space-between">
          <Text>{username || '--'}</Text>
          <Text onClick={handleStartEdit} style={{ cursor: 'pointer', fontSize: 13 }}>
            {t('profile.updateUsername')}
          </Text>
        </Flexbox>
      )}
    </motion.div>
  );

  if (mobile) {
    return (
      <Flexbox gap={12} style={rowStyle}>
        <Flexbox align="center" horizontal justify="space-between">
          <Text strong>{t('profile.username')}</Text>
          {!isEditing && (
            <Text onClick={handleStartEdit} style={{ cursor: 'pointer', fontSize: 13 }}>
              {t('profile.updateUsername')}
            </Text>
          )}
        </Flexbox>
        <AnimatePresence mode="wait">{isEditing ? editingContent : displayContent}</AnimatePresence>
      </Flexbox>
    );
  }

  return (
    <Flexbox gap={24} horizontal style={rowStyle}>
      <Text style={labelStyle}>{t('profile.username')}</Text>
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
      const { requestPasswordReset } = await import('@/libs/better-auth/auth-client');
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
        <Text
          onClick={sending ? undefined : handleChangePassword}
          style={{
            cursor: sending ? 'default' : 'pointer',
            fontSize: 13,
            opacity: sending ? 0.5 : 1,
          }}
        >
          {hasPasswordAccount ? t('profile.changePassword') : t('profile.setPassword')}
        </Text>
      }
      label={t('profile.password')}
      mobile={mobile}
    >
      <Text>{hasPasswordAccount ? '••••••' : '--'}</Text>
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
  const enableKlavis = useServerConfigStore(serverConfigSelectors.enableKlavis);

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
    <Flexbox gap={0} paddingInline={mobile ? 16 : 0} width={'100%'}>
      <Text fontSize={16} strong style={{ marginBottom: 32 }}>
        {t('profile.title')}
      </Text>

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

      {/* Interests Row - Editable */}
      <InterestsRow mobile={mobile} />

      <Divider style={{ margin: 0 }} />

      {/* Password Row - For Better Auth users to change or set password */}
      {!isDesktop && isLoginWithBetterAuth && (
        <>
          <PasswordRow mobile={mobile} />
          <Divider style={{ margin: 0 }} />
        </>
      )}

      {/* Email Row - Read Only */}
      {isLoginWithAuth && userProfile?.email && (
        <>
          <ProfileRow label={t('profile.email')} mobile={mobile}>
            <Text>{userProfile.email}</Text>
          </ProfileRow>
          <Divider style={{ margin: 0 }} />
        </>
      )}

      {/* SSO Providers Row */}
      {isLoginWithAuth && (
        <>
          <ProfileRow label={t('profile.sso.providers')} mobile={mobile}>
            <SSOProvidersList />
          </ProfileRow>
          <Divider style={{ margin: 0 }} />
        </>
      )}

      {/* Klavis Authorizations Row */}
      {enableKlavis && (
        <ProfileRow label={t('profile.authorizations.title')} mobile={mobile}>
          <KlavisAuthorizationList />
        </ProfileRow>
      )}
    </Flexbox>
  );
});

export default Client;
