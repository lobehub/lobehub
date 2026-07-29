'use client';

import { OFFICIAL_URL } from '@lobechat/const';
import {
  Avatar,
  Block,
  Center,
  Flexbox,
  Icon,
  Input,
  Tag,
  Text,
  TextArea,
  Tooltip,
} from '@lobehub/ui';
import { Button, Tabs } from '@lobehub/ui/base-ui';
import type { TableColumnsType, UploadProps } from 'antd';
import { App, Input as AntInput, Table, Upload } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  ArrowLeft,
  CircleHelp,
  Globe,
  ImagePlus,
  RefreshCw,
  Settings,
  Trash2,
  Users,
} from 'lucide-react';
import {
  memo,
  type PropsWithChildren,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import {
  type CommunityWorkspaceMember,
  useCommunityWorkspaceMembers,
} from '@/business/client/hooks/useCommunityWorkspaceMembers';
import { useCommunityWorkspaceProfile } from '@/business/client/hooks/useCommunityWorkspaceProfile';
import {
  isCommunityWorkspaceNamespaceTakenError,
  syncCommunityWorkspaceMembers,
  updateCommunityWorkspaceProfile,
} from '@/business/client/services/communityWorkspaceProfile';
import EmojiPicker from '@/components/EmojiPicker';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';
import { useFileStore } from '@/store/file';

const MAX_FILE_SIZE = 2 * 1024 * 1024;
const NAMESPACE_MAX = 32;
const NAMESPACE_MIN = 3;
const DESCRIPTION_MAX = 200;
const DISPLAY_NAME_MAX = 50;
const ORGANIZATION_URL_PREFIX = `${OFFICIAL_URL.replace(/^https?:\/\//, '')}/community/org/`;
const NAMESPACE_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

const styles = createStaticStyles(({ css, cssVar }) => ({
  footer: css`
    padding-block: 12px;
    padding-inline: 20px;
    border-block-start: 1px solid ${cssVar.colorFillTertiary};
    background: ${cssVar.colorFillQuaternary};
  `,
  hint: css`
    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
  `,
  memberNameLink: css`
    color: inherit;

    &:hover {
      color: ${cssVar.colorPrimary};
    }
  `,
}));

/**
 * The default Market namespace equals the raw cloud userId (e.g.
 * `user_2gmZCHLaTfh1X48VhuK9OKlNeF1`) — Market's trusted-client user creation
 * writes `authUserId` straight into `accounts.namespace`, so it always
 * contains uppercase letters. A user-chosen handle must match Market's org
 * namespace regex `/^[\da-z][\d_a-z-]*$/`, i.e. lowercase only. Presence of
 * an uppercase letter is therefore a reliable "this is the auto-assigned
 * placeholder handle, don't surface it" signal.
 */
const isDefaultMarketNamespace = (namespace: string | null): boolean =>
  !!namespace && /[A-Z]/.test(namespace);

interface SettingCardProps {
  action?: ReactNode;
  children?: ReactNode;
  description?: ReactNode;
  hint?: ReactNode;
  title: ReactNode;
}

const SettingCard = memo<SettingCardProps>(({ title, description, children, hint, action }) => (
  <Block variant="outlined">
    <Flexbox gap={12} padding={20}>
      <Flexbox gap={4}>
        <Text strong as="h3" style={{ fontSize: 16, margin: 0 }}>
          {title}
        </Text>
        {description && (
          <Text style={{ fontSize: 13 }} type="secondary">
            {description}
          </Text>
        )}
      </Flexbox>
      {children}
    </Flexbox>
    {(hint || action) && (
      <Flexbox horizontal align="center" className={styles.footer} gap={12} justify="space-between">
        <span className={styles.hint}>{hint ?? ''}</span>
        {action}
      </Flexbox>
    )}
  </Block>
));

SettingCard.displayName = 'CommunityWorkspaceSettingCard';

const PageContainer = memo<PropsWithChildren>(({ children }) => (
  <Flexbox height="100%" style={{ overflowX: 'hidden', overflowY: 'auto' }} width="100%">
    <Flexbox
      gap={16}
      padding={24}
      style={{ boxSizing: 'border-box', margin: '0 auto', maxWidth: 1200, width: '100%' }}
    >
      {children}
    </Flexbox>
  </Flexbox>
));

PageContainer.displayName = 'CommunityWorkspaceSettingsPageContainer';

const MembersCard = memo<{ canManage: boolean }>(({ canManage }) => {
  const { t } = useTranslation('discover');
  const { message } = App.useApp();
  const { canSync, isLoading, members, refresh } = useCommunityWorkspaceMembers();
  const [syncing, setSyncing] = useState(false);

  const canTriggerSync = canManage && canSync;

  const handleSync = useCallback(async () => {
    setSyncing(true);
    try {
      await syncCommunityWorkspaceMembers();
      await refresh();
      message.success(t('user.workspaceProfile.settings.members.syncSuccess'));
    } catch (error) {
      message.error(
        (error as Error).message || t('user.workspaceProfile.settings.members.syncFailed'),
      );
    } finally {
      setSyncing(false);
    }
  }, [message, refresh, t]);

  const columns = useMemo<TableColumnsType<CommunityWorkspaceMember>>(
    () => [
      {
        dataIndex: 'displayName',
        render: (_, member) => {
          const name =
            member.displayName || member.userName || member.namespace || `#${member.accountId}`;
          // Prefer `userName` — it's Market's URL-safe public handle
          // (`/community/user/:slug`) and lines up with what shows on the
          // user's own profile page. Fall back to `namespace` only when
          // there's no userName AND the namespace is a user-chosen handle;
          // the auto-assigned `user_<mixedCaseId>` placeholder is filtered
          // out (see isDefaultMarketNamespace).
          const publicHandle =
            member.userName ||
            (member.namespace && !isDefaultMarketNamespace(member.namespace)
              ? member.namespace
              : null);
          // The `/community/user/:slug` page accepts either handle as a slug,
          // so we keep the row clickable even when we hide the literal handle
          // — the display name still links out to the user's profile.
          const profileSlug = publicHandle || member.namespace;
          const profileUrl = profileSlug ? `/community/user/${profileSlug}` : undefined;

          const nameNode = (
            <Text strong style={{ fontSize: 14 }}>
              {name}
            </Text>
          );

          return (
            <Flexbox horizontal align="center" gap={12}>
              <Avatar avatar={member.avatarUrl || undefined} size={36} title={name} />
              <Flexbox gap={2}>
                {profileUrl ? (
                  <a
                    className={styles.memberNameLink}
                    href={profileUrl}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {nameNode}
                  </a>
                ) : (
                  nameNode
                )}
                {publicHandle && profileUrl && (
                  <a
                    className={styles.memberNameLink}
                    href={profileUrl}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    <Text style={{ fontSize: 12 }} type="secondary">
                      @{publicHandle}
                    </Text>
                  </a>
                )}
              </Flexbox>
            </Flexbox>
          );
        },
        title: t('user.workspaceProfile.settings.members.column.member'),
      },
      {
        align: 'left',
        dataIndex: 'role',
        onCell: () => ({ style: { verticalAlign: 'middle' } }),
        render: (role: CommunityWorkspaceMember['role']) => (
          <Tag>
            {role === 'admin'
              ? t('user.workspaceProfile.settings.members.role.admin')
              : t('user.workspaceProfile.settings.members.role.member')}
          </Tag>
        ),
        title: t('user.workspaceProfile.settings.members.column.role'),
        width: 120,
      },
    ],
    [t],
  );

  return (
    <SettingCard
      description={t('user.workspaceProfile.settings.members.description')}
      hint={t('user.workspaceProfile.settings.members.syncHint')}
      title={t('user.workspaceProfile.settings.members.title')}
      action={
        <Button disabled={!canTriggerSync} icon={RefreshCw} loading={syncing} onClick={handleSync}>
          {t('user.workspaceProfile.settings.members.sync')}
        </Button>
      }
    >
      <Table
        columns={columns}
        dataSource={members}
        loading={isLoading && members.length === 0}
        pagination={false}
        rowKey={'accountId'}
        size={'middle'}
        locale={{
          emptyText: (
            <Text style={{ fontSize: 13 }} type="secondary">
              {t('user.workspaceProfile.settings.members.empty')}
            </Text>
          ),
        }}
      />
    </SettingCard>
  );
});

MembersCard.displayName = 'CommunityWorkspaceMembersCard';

const trimOptional = (value: string | undefined) => {
  const trimmed = value?.trim();
  return trimmed || undefined;
};

const isValidUrl = (value: string) => {
  if (!value.trim()) return true;
  try {
    const { protocol } = new URL(value.trim());
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
};

const CommunityWorkspaceSettings = memo(() => {
  const { t } = useTranslation('discover');
  const { message } = App.useApp();
  const navigate = useWorkspaceAwareNavigate();
  const { allowed: canManageSettings, reason: permissionReason } = usePermission('manage_settings');
  const uploadWithProgress = useFileStore((s) => s.uploadWithProgress);
  const {
    avatarUrl: remoteAvatarUrl,
    bannerUrl: remoteBannerUrl,
    canEdit: canEditCommunityProfile,
    description: remoteDescription,
    displayName: remoteDisplayName,
    isLoading,
    profile,
    refresh,
    username,
  } = useCommunityWorkspaceProfile();

  const canEdit = canManageSettings && canEditCommunityProfile && !!profile;
  const disabledReason = !canManageSettings
    ? permissionReason
    : t('user.workspaceProfile.settings.noPermission');

  const [displayName, setDisplayName] = useState(remoteDisplayName ?? '');
  const [namespace, setNamespace] = useState(username ?? '');
  const [description, setDescription] = useState(remoteDescription ?? '');
  const [websiteUrl, setWebsiteUrl] = useState(profile?.websiteUrl ?? '');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(remoteAvatarUrl ?? null);
  const [bannerUrl, setBannerUrl] = useState<string | null>(remoteBannerUrl ?? null);
  const [savingField, setSavingField] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [bannerUploading, setBannerUploading] = useState(false);
  const [namespaceError, setNamespaceError] = useState<string | undefined>();
  const [websiteError, setWebsiteError] = useState<string | undefined>();
  const [activeTab, setActiveTab] = useState<'members' | 'profile'>('profile');

  const handleBack = useCallback(() => {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }

    navigate('/community/workspace');
  }, [navigate]);

  const renderHeader = () => (
    <Flexbox horizontal align="center" gap={8}>
      <Button icon={ArrowLeft} type="text" onClick={handleBack}>
        {t('user.workspaceProfile.settings.back')}
      </Button>
    </Flexbox>
  );

  useEffect(() => {
    setDisplayName(remoteDisplayName ?? '');
    setNamespace(username ?? '');
    setDescription(remoteDescription ?? '');
    setWebsiteUrl(profile?.websiteUrl ?? '');
    setAvatarUrl(remoteAvatarUrl ?? null);
    setBannerUrl(remoteBannerUrl ?? null);
    setNamespaceError(undefined);
    setWebsiteError(undefined);
  }, [
    profile?.accountId,
    profile?.websiteUrl,
    remoteAvatarUrl,
    remoteBannerUrl,
    remoteDescription,
    remoteDisplayName,
    username,
  ]);

  const updateProfile = useCallback(
    async (field: string, input: Parameters<typeof updateCommunityWorkspaceProfile>[0]) => {
      if (!canEdit) return;
      setSavingField(field);
      try {
        await updateCommunityWorkspaceProfile(input);
        await refresh();
        message.success(t('user.workspaceProfile.settings.updateSuccess'));
      } catch (error) {
        if (field === 'namespace' && isCommunityWorkspaceNamespaceTakenError(error)) {
          setNamespaceError(t('user.workspaceProfile.settings.namespaceTaken'));
        } else {
          message.error(
            (error as Error).message || t('user.workspaceProfile.settings.updateFailed'),
          );
        }
      } finally {
        setSavingField(null);
      }
    },
    [canEdit, message, refresh, t],
  );

  const buildSaveButton = (field: string, disabled: boolean, onClick: () => void) => {
    const button = (
      <Button
        disabled={!canEdit || disabled || isLoading}
        loading={savingField === field}
        type="primary"
        onClick={onClick}
      >
        {t('user.workspaceProfile.save')}
      </Button>
    );

    if (canEdit) return button;

    return (
      <Tooltip title={disabledReason}>
        <span>{button}</span>
      </Tooltip>
    );
  };

  const namespaceValidation = useMemo(() => {
    const value = namespace.trim();
    if (!value) return t('user.workspaceProfile.errors.namespace.required');
    if (value.length < NAMESPACE_MIN || value.length > NAMESPACE_MAX)
      return t('user.workspaceProfile.errors.namespace.length');
    if (!NAMESPACE_PATTERN.test(value)) return t('user.workspaceProfile.errors.namespace.pattern');
    return namespaceError;
  }, [namespace, namespaceError, t]);

  const handleAvatarUpload = useCallback(
    async (file: File) => {
      if (file.size > MAX_FILE_SIZE) {
        message.error(t('user.workspaceProfile.errors.fileTooLarge'));
        return;
      }

      setAvatarUploading(true);
      try {
        const result = await uploadWithProgress({ file });
        if (!result?.url) {
          message.error(t('user.workspaceProfile.errors.uploadFailed'));
          return;
        }
        setAvatarUrl(
          result.url.startsWith('/') ? `${window.location.origin}${result.url}` : result.url,
        );
      } catch (error) {
        console.error('[CommunityWorkspaceSettings] Avatar upload failed:', error);
        message.error(t('user.workspaceProfile.errors.uploadFailed'));
      } finally {
        setAvatarUploading(false);
      }
    },
    [message, t, uploadWithProgress],
  );

  const handleBannerUpload: UploadProps['customRequest'] = useCallback(
    async (options: Parameters<NonNullable<UploadProps['customRequest']>>[0]) => {
      const file = options.file as File;

      if (file.size > MAX_FILE_SIZE) {
        message.error(t('user.workspaceProfile.errors.fileTooLarge'));
        options.onError?.(new Error('File too large'));
        return;
      }

      setBannerUploading(true);
      try {
        const result = await uploadWithProgress({ file });
        if (!result?.url) {
          message.error(t('user.workspaceProfile.errors.uploadFailed'));
          options.onError?.(new Error('Upload failed'));
          return;
        }
        const url = result.url.startsWith('/')
          ? `${window.location.origin}${result.url}`
          : result.url;
        setBannerUrl(url);
        options.onSuccess?.(result);
      } catch (error) {
        console.error('[CommunityWorkspaceSettings] Banner upload failed:', error);
        message.error(t('user.workspaceProfile.errors.uploadFailed'));
        options.onError?.(error as Error);
      } finally {
        setBannerUploading(false);
      }
    },
    [message, t, uploadWithProgress],
  );

  if (!profile) {
    return <PageContainer>{renderHeader()}</PageContainer>;
  }

  const displayNameDirty = displayName.trim() !== (remoteDisplayName ?? '');
  const namespaceDirty = namespace.trim() !== (username ?? '');
  const descriptionDirty = description.trim() !== (remoteDescription ?? '');
  const websiteDirty = websiteUrl.trim() !== (profile.websiteUrl ?? '');
  const avatarDirty = avatarUrl !== (remoteAvatarUrl ?? null);
  const bannerDirty = bannerUrl !== (remoteBannerUrl ?? null);

  return (
    <PageContainer>
      {renderHeader()}

      <Tabs
        activeKey={activeTab}
        items={[
          {
            icon: <Icon icon={Settings} size={16} />,
            key: 'profile',
            label: t('user.workspaceProfile.settings.tabs.profile'),
          },
          {
            icon: <Icon icon={Users} size={16} />,
            key: 'members',
            label: t('user.workspaceProfile.settings.tabs.members'),
          },
        ]}
        onChange={(key) => setActiveTab(key as 'members' | 'profile')}
      />

      {activeTab === 'members' && <MembersCard canManage={canManageSettings} />}

      {activeTab === 'profile' && (
        <>
          <SettingCard
            description={t('user.workspaceProfile.settings.displayName.description')}
            hint={t('user.workspaceProfile.fields.displayName.maxLength')}
            title={t('user.workspaceProfile.fields.displayName')}
            action={buildSaveButton('displayName', !displayNameDirty || !displayName.trim(), () =>
              updateProfile('displayName', { displayName: displayName.trim() }),
            )}
          >
            <Input
              showCount
              disabled={!canEdit}
              maxLength={DISPLAY_NAME_MAX}
              style={{ maxWidth: 420 }}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </SettingCard>

          <SettingCard
            description={t('user.workspaceProfile.settings.namespace.description')}
            title={t('user.workspaceProfile.fields.namespace')}
            action={buildSaveButton('namespace', !namespaceDirty || !!namespaceValidation, () =>
              updateProfile('namespace', { namespace: namespace.trim() }),
            )}
            hint={
              namespaceValidation ||
              t('user.workspaceProfile.settings.namespace.hint', {
                max: NAMESPACE_MAX,
              })
            }
          >
            <AntInput
              showCount
              addonBefore={ORGANIZATION_URL_PREFIX}
              disabled={!canEdit}
              maxLength={NAMESPACE_MAX}
              status={namespaceValidation ? 'error' : undefined}
              style={{ maxWidth: 560 }}
              value={namespace}
              onChange={(e) => {
                setNamespace(e.target.value);
                setNamespaceError(undefined);
              }}
            />
          </SettingCard>

          <SettingCard
            description={t('user.workspaceProfile.settings.description.description')}
            hint={t('user.workspaceProfile.fields.description.maxLength')}
            title={t('user.workspaceProfile.fields.description')}
            action={buildSaveButton('description', !descriptionDirty, () =>
              updateProfile('description', { description: trimOptional(description) }),
            )}
          >
            <TextArea
              showCount
              disabled={!canEdit}
              maxLength={DESCRIPTION_MAX}
              rows={3}
              style={{ maxWidth: 560 }}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </SettingCard>

          <SettingCard
            description={t('user.workspaceProfile.settings.website.description')}
            hint={websiteError || t('user.workspaceProfile.settings.website.hint')}
            title={t('user.workspaceProfile.fields.websiteUrl')}
            action={buildSaveButton('websiteUrl', !websiteDirty || !!websiteError, () =>
              updateProfile('websiteUrl', { websiteUrl: trimOptional(websiteUrl) }),
            )}
          >
            <Input
              disabled={!canEdit}
              status={websiteError ? 'error' : undefined}
              style={{ maxWidth: 560 }}
              value={websiteUrl}
              prefix={
                <Icon color={cssVar.colorTextSecondary} icon={Globe} style={{ marginRight: 8 }} />
              }
              onChange={(e) => {
                const next = e.target.value;
                setWebsiteUrl(next);
                setWebsiteError(
                  isValidUrl(next) ? undefined : t('user.workspaceProfile.errors.url'),
                );
              }}
            />
          </SettingCard>

          <SettingCard
            description={t('user.workspaceProfile.settings.avatar.description')}
            hint={t('user.workspaceProfile.settings.avatar.hint')}
            title={t('user.workspaceProfile.fields.avatar')}
            action={buildSaveButton('avatarUrl', !avatarDirty || avatarUploading, () =>
              updateProfile('avatarUrl', { avatarUrl }),
            )}
          >
            <EmojiPicker
              allowDelete={canEdit && !!avatarUrl}
              allowUpload={canEdit ? { enableEmoji: true } : false}
              loading={avatarUploading}
              shape="square"
              size={80}
              value={avatarUrl || undefined}
              onDelete={canEdit ? () => setAvatarUrl(null) : undefined}
              onUpload={canEdit ? handleAvatarUpload : undefined}
              onChange={
                canEdit
                  ? (next) => {
                      if (!next.startsWith('data:')) setAvatarUrl(next || null);
                    }
                  : undefined
              }
            />
          </SettingCard>

          <SettingCard
            description={t('user.workspaceProfile.settings.banner.description')}
            hint={t('user.workspaceProfile.fields.bannerUrl.tooltip')}
            action={buildSaveButton('bannerUrl', !bannerDirty || bannerUploading, () =>
              updateProfile('bannerUrl', { bannerUrl }),
            )}
            title={
              <Flexbox horizontal align="center" gap={4}>
                {t('user.workspaceProfile.fields.bannerUrl')}
                <Tooltip title={t('user.workspaceProfile.fields.bannerUrl.tooltip')}>
                  <CircleHelp size={14} style={{ cursor: 'help', opacity: 0.5 }} />
                </Tooltip>
              </Flexbox>
            }
          >
            <Flexbox gap={8} width="100%">
              <Upload
                accept="image/*"
                customRequest={handleBannerUpload}
                disabled={!canEdit}
                maxCount={1}
                showUploadList={false}
                style={{ display: 'block', width: '100%' }}
              >
                <div
                  style={{
                    backgroundColor: bannerUrl ? undefined : cssVar.colorFillTertiary,
                    backgroundImage: bannerUrl ? `url(${bannerUrl})` : undefined,
                    backgroundPosition: 'center',
                    backgroundSize: 'cover',
                    borderRadius: cssVar.borderRadiusLG,
                    cursor: canEdit ? 'pointer' : 'not-allowed',
                    height: 160,
                    maxWidth: 560,
                    overflow: 'hidden',
                    position: 'relative',
                    width: '100%',
                  }}
                >
                  <Center
                    style={{
                      background: bannerUrl ? 'rgba(0,0,0,0.4)' : 'transparent',
                      height: '100%',
                      opacity: bannerUrl ? 0 : 1,
                      transition: 'opacity 0.2s',
                      width: '100%',
                    }}
                    onMouseEnter={(e) => {
                      if (canEdit) e.currentTarget.style.opacity = '1';
                    }}
                    onMouseLeave={(e) => {
                      if (canEdit && bannerUrl) e.currentTarget.style.opacity = '0';
                    }}
                  >
                    <Flexbox align="center" gap={8}>
                      <ImagePlus
                        size={24}
                        style={{ color: bannerUrl ? '#fff' : cssVar.colorTextSecondary }}
                      />
                      <Text
                        style={{
                          color: bannerUrl ? '#fff' : cssVar.colorTextSecondary,
                          fontSize: 12,
                        }}
                      >
                        {bannerUploading
                          ? t('user.workspaceProfile.fields.bannerUrl.uploading')
                          : t('user.workspaceProfile.fields.bannerUrl.clickToUpload')}
                      </Text>
                    </Flexbox>
                  </Center>
                </div>
              </Upload>
              {canEdit && bannerUrl && (
                <Flexbox horizontal align="center" gap={8} justify="flex-start">
                  <Button
                    danger
                    icon={<Trash2 size={12} />}
                    size="small"
                    type="text"
                    onClick={() => setBannerUrl(null)}
                  >
                    {t('user.workspaceProfile.fields.bannerUrl.remove')}
                  </Button>
                </Flexbox>
              )}
            </Flexbox>
          </SettingCard>
        </>
      )}
    </PageContainer>
  );
});

CommunityWorkspaceSettings.displayName = 'CommunityWorkspaceSettings';

export default CommunityWorkspaceSettings;
