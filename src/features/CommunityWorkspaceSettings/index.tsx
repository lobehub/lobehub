'use client';

import { OFFICIAL_URL } from '@lobechat/const';
import {
  Button,
  Center,
  cssVar,
  Flexbox,
  Icon,
  Input,
  Table,
  type TableColumn,
  Tabs,
  Tag,
  Text,
  TextArea,
  toast,
  Tooltip,
  Upload,
} from '@lobehub/ui';
import { cssVar as sxVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
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
import SettingCard from '@/components/SettingCard';
import UserAvatar from '@/components/UserAvatar';
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

const styles = stylex.create({
  memberNameLink: { color: { 'default': 'inherit', ':hover': sxVar.colorPrimary } },
});

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

  const { canSync, isLoading, members, refresh } = useCommunityWorkspaceMembers();
  const [syncing, setSyncing] = useState(false);
  /** Sync failure, shown in the card footer beside the Sync button rather than a corner toast. */
  const [syncError, setSyncError] = useState('');

  const canTriggerSync = canManage && canSync;

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setSyncError('');
    try {
      await syncCommunityWorkspaceMembers();
      await refresh();
      toast.success(t('user.workspaceProfile.settings.members.syncSuccess'));
    } catch (error) {
      console.error('[CommunityWorkspaceSettings] Member sync failed:', error);
      setSyncError(t('user.workspaceProfile.settings.members.syncFailedRetry'));
    } finally {
      setSyncing(false);
    }
  }, [refresh, t]);

  const columns = useMemo<TableColumn<CommunityWorkspaceMember>[]>(
    () => [
      {
        dataIndex: 'displayName',
        render: (_, member) => {
          const name =
            member.displayName || member.userName || member.namespace || `#${member.accountId}`;
          // Prefer `userName` — it's Market's URL-safe public handle
          // (`/marketplace/user/:slug`) and lines up with what shows on the
          // user's own profile page. Fall back to `namespace` only when
          // there's no userName AND the namespace is a user-chosen handle;
          // the auto-assigned `user_<mixedCaseId>` placeholder is filtered
          // out (see isDefaultMarketNamespace).
          const publicHandle =
            member.userName ||
            (member.namespace && !isDefaultMarketNamespace(member.namespace)
              ? member.namespace
              : null);
          // The `/marketplace/user/:slug` page accepts either handle as a slug,
          // so we keep the row clickable even when we hide the literal handle
          // — the display name still links out to the user's profile.
          const profileSlug = publicHandle || member.namespace;
          const profileUrl = profileSlug ? `/marketplace/user/${profileSlug}` : undefined;

          const nameNode = (
            <Text strong style={{ fontSize: 14 }}>
              {name}
            </Text>
          );

          return (
            <Flexbox horizontal align="center" gap={12}>
              <UserAvatar avatar={member.avatarUrl} name={name} size={36} />
              <Flexbox gap={2}>
                {profileUrl ? (
                  <a
                    {...stylex.props(styles.memberNameLink)}
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
                    {...stylex.props(styles.memberNameLink)}
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
      title={t('user.workspaceProfile.settings.members.title')}
      action={
        <Button disabled={!canTriggerSync} icon={RefreshCw} loading={syncing} onClick={handleSync}>
          {t('user.workspaceProfile.settings.members.sync')}
        </Button>
      }
      hint={
        syncError ? (
          <Text role="alert" style={{ fontSize: 13 }} type="danger">
            {syncError}
          </Text>
        ) : (
          t('user.workspaceProfile.settings.members.syncHint')
        )
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
  /** Upload refusals render under their picker; the page stays open, so a corner toast would sit away from it. */
  const [avatarError, setAvatarError] = useState('');
  const [bannerError, setBannerError] = useState('');
  const [namespaceError, setNamespaceError] = useState<string | undefined>();
  const [websiteError, setWebsiteError] = useState<string | undefined>();
  /**
   * Save failure of one card, shown in that card's footer beside its Save button. Server
   * messages are untranslated, so the copy is fixed and the raw error only goes to the console.
   */
  const [saveError, setSaveError] = useState<{ field: string; message: string } | null>(null);
  const [activeTab, setActiveTab] = useState<'members' | 'profile'>('profile');

  const handleBack = useCallback(() => {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }

    navigate('/marketplace/workspace');
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
      setSaveError(null);
      try {
        await updateCommunityWorkspaceProfile(input);
        await refresh();
        toast.success(t('user.workspaceProfile.settings.updateSuccess'));
      } catch (error) {
        if (field === 'namespace' && isCommunityWorkspaceNamespaceTakenError(error)) {
          setNamespaceError(t('user.workspaceProfile.settings.namespaceTaken'));
        } else {
          console.error('[CommunityWorkspaceSettings] Profile update failed:', error);
          setSaveError({ field, message: t('user.workspaceProfile.settings.updateFailedRetry') });
        }
      } finally {
        setSavingField(null);
      }
    },
    [canEdit, refresh, t],
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

  /** Footer hint of a card, replaced by that card's save failure while one is shown. */
  const hintFor = (field: string, hint: ReactNode) =>
    saveError?.field === field ? (
      <Text role="alert" style={{ fontSize: 13 }} type="danger">
        {saveError.message}
      </Text>
    ) : (
      hint
    );

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
      setAvatarError('');
      if (file.size > MAX_FILE_SIZE) {
        setAvatarError(t('user.workspaceProfile.errors.fileTooLarge'));
        return;
      }

      setAvatarUploading(true);
      try {
        const result = await uploadWithProgress({ file });
        if (!result?.url) {
          setAvatarError(t('user.workspaceProfile.errors.uploadFailedRetry'));
          return;
        }
        setAvatarUrl(
          result.url.startsWith('/') ? `${window.location.origin}${result.url}` : result.url,
        );
      } catch (error) {
        console.error('[CommunityWorkspaceSettings] Avatar upload failed:', error);
        setAvatarError(t('user.workspaceProfile.errors.uploadFailedRetry'));
      } finally {
        setAvatarUploading(false);
      }
    },
    [t, uploadWithProgress],
  );

  const handleBannerUpload = useCallback(
    async (file: File) => {
      setBannerError('');
      if (file.size > MAX_FILE_SIZE) {
        setBannerError(t('user.workspaceProfile.errors.fileTooLarge'));
        return;
      }

      setBannerUploading(true);
      try {
        const result = await uploadWithProgress({ file });
        if (!result?.url) {
          setBannerError(t('user.workspaceProfile.errors.uploadFailedRetry'));
          return;
        }
        const url = result.url.startsWith('/')
          ? `${window.location.origin}${result.url}`
          : result.url;
        setBannerUrl(url);
      } catch (error) {
        console.error('[CommunityWorkspaceSettings] Banner upload failed:', error);
        setBannerError(t('user.workspaceProfile.errors.uploadFailedRetry'));
      } finally {
        setBannerUploading(false);
      }
    },
    [t, uploadWithProgress],
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
            hint={hintFor('displayName', t('user.workspaceProfile.fields.displayName.maxLength'))}
            title={t('user.workspaceProfile.fields.displayName')}
            action={buildSaveButton('displayName', !displayNameDirty || !displayName.trim(), () =>
              updateProfile('displayName', { displayName: displayName.trim() }),
            )}
          >
            <Input
              disabled={!canEdit}
              maxLength={DISPLAY_NAME_MAX}
              style={{ maxWidth: 420 }}
              suffix={`${displayName.length} / ${DISPLAY_NAME_MAX}`}
              value={displayName}
              onChange={(e) => {
                setDisplayName(e.target.value);
                if (saveError?.field === 'displayName') setSaveError(null);
              }}
            />
          </SettingCard>

          <SettingCard
            description={t('user.workspaceProfile.settings.namespace.description')}
            title={t('user.workspaceProfile.fields.namespace')}
            action={buildSaveButton('namespace', !namespaceDirty || !!namespaceValidation, () =>
              updateProfile('namespace', { namespace: namespace.trim() }),
            )}
            hint={hintFor(
              'namespace',
              namespaceValidation ||
                t('user.workspaceProfile.settings.namespace.hint', {
                  max: NAMESPACE_MAX,
                }),
            )}
          >
            <Input
              aria-invalid={!!namespaceValidation}
              data-invalid={namespaceValidation ? '' : undefined}
              disabled={!canEdit}
              maxLength={NAMESPACE_MAX}
              prefix={ORGANIZATION_URL_PREFIX}
              style={{ maxWidth: 560 }}
              suffix={`${namespace.length} / ${NAMESPACE_MAX}`}
              value={namespace}
              onChange={(e) => {
                setNamespace(e.target.value);
                setNamespaceError(undefined);
                if (saveError?.field === 'namespace') setSaveError(null);
              }}
            />
          </SettingCard>

          <SettingCard
            description={t('user.workspaceProfile.settings.description.description')}
            hint={hintFor('description', t('user.workspaceProfile.fields.description.maxLength'))}
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
              onChange={(e) => {
                setDescription(e.target.value);
                if (saveError?.field === 'description') setSaveError(null);
              }}
            />
          </SettingCard>

          <SettingCard
            description={t('user.workspaceProfile.settings.website.description')}
            title={t('user.workspaceProfile.fields.websiteUrl')}
            action={buildSaveButton('websiteUrl', !websiteDirty || !!websiteError, () =>
              updateProfile('websiteUrl', { websiteUrl: trimOptional(websiteUrl) }),
            )}
            hint={hintFor(
              'websiteUrl',
              websiteError || t('user.workspaceProfile.settings.website.hint'),
            )}
          >
            <Input
              aria-invalid={!!websiteError}
              data-invalid={websiteError ? '' : undefined}
              disabled={!canEdit}
              style={{ maxWidth: 560 }}
              value={websiteUrl}
              prefix={
                <Icon color={cssVar.colorTextSecondary} icon={Globe} style={{ marginRight: 8 }} />
              }
              onChange={(e) => {
                const next = e.target.value;
                setWebsiteUrl(next);
                if (saveError?.field === 'websiteUrl') setSaveError(null);
                setWebsiteError(
                  isValidUrl(next) ? undefined : t('user.workspaceProfile.errors.url'),
                );
              }}
            />
          </SettingCard>

          <SettingCard
            description={t('user.workspaceProfile.settings.avatar.description')}
            hint={hintFor('avatarUrl', t('user.workspaceProfile.settings.avatar.hint'))}
            title={t('user.workspaceProfile.fields.avatar')}
            action={buildSaveButton('avatarUrl', !avatarDirty || avatarUploading, () =>
              updateProfile('avatarUrl', { avatarUrl }),
            )}
          >
            <Flexbox gap={8}>
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
              {avatarError && (
                <Text fontSize={12} role="alert" type="danger">
                  {avatarError}
                </Text>
              )}
            </Flexbox>
          </SettingCard>

          <SettingCard
            description={t('user.workspaceProfile.settings.banner.description')}
            hint={hintFor('bannerUrl', t('user.workspaceProfile.fields.bannerUrl.tooltip'))}
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
                disabled={!canEdit}
                maxCount={1}
                style={{ display: 'block', width: '100%' }}
                onFiles={([file]) => handleBannerUpload(file)}
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
              {bannerError && (
                <Text fontSize={12} role="alert" type="danger">
                  {bannerError}
                </Text>
              )}
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
