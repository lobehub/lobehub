'use client';

import { OFFICIAL_URL } from '@lobechat/const';
import type { CollapseProps } from '@lobehub/ui';
import {
  Button,
  Center,
  Collapse,
  Flexbox,
  Icon,
  Input,
  Text,
  TextArea,
  Tooltip,
} from '@lobehub/ui';
import { useModalContext } from '@lobehub/ui/base-ui';
import type { UploadProps } from 'antd';
import { App, Form, Input as AntInput, Upload } from 'antd';
import { cssVar } from 'antd-style';
import { CircleHelp, Globe, ImagePlus, Loader2, Trash2 } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  checkCommunityWorkspaceNamespaceAvailable,
  isCommunityWorkspaceNamespaceTakenError,
  setupCommunityWorkspaceProfile,
  updateCommunityWorkspaceProfile,
} from '@/business/client/services/communityWorkspaceProfile';
import AvatarUpload from '@/components/AvatarUpload';
import { useFileStore } from '@/store/file';
import type { DiscoverUserInfo } from '@/types/discover';

interface FormValues {
  description?: string;
  displayName: string;
  namespace?: string;
  websiteUrl?: string;
}

interface ContentProps {
  onSuccess?: () => void | Promise<void>;
  user: DiscoverUserInfo;
}

const trimOptional = (value: string | undefined) => {
  const trimmed = value?.trim();
  return trimmed || undefined;
};

const MAX_FILE_SIZE = 2 * 1024 * 1024;
const ORGANIZATION_URL_PREFIX = `${OFFICIAL_URL.replace(/^https?:\/\//, '')}/community/org/`;

const normalizeNamespace = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9-]/g, '-')
    .replaceAll(/-+/g, '-')
    .replaceAll(/^-|-$/g, '')
    .slice(0, 32);

// Mirrors the namespace Form rules below — only run the live availability check
// once the handle is well-formed, so we don't probe Market for invalid input.
const NAMESPACE_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const isNamespaceFormatValid = (value: string) =>
  value.length >= 3 && value.length <= 32 && NAMESPACE_PATTERN.test(value);

type NamespaceAvailability = 'available' | 'checking' | 'idle' | 'taken';

export const Content = memo<ContentProps>(({ user, onSuccess }) => {
  const { t } = useTranslation('discover');
  const { message } = App.useApp();
  const { close } = useModalContext();
  const [form] = Form.useForm<FormValues>();
  const uploadWithProgress = useFileStore((s) => s.uploadWithProgress);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user.avatarUrl ?? null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [bannerUrl, setBannerUrl] = useState<string | null>(user.bannerUrl ?? null);
  const [bannerUploading, setBannerUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const isSetup = !user.namespace;

  // Live namespace-availability check (setup only — the handle is immutable once
  // set). Mirrors the workspace create wizard's slug check: debounce, only probe
  // a well-formed handle, and treat it purely as a UX hint — the setup mutation
  // still rejects a taken handle on submit.
  const namespaceValue = Form.useWatch('namespace', form);
  const trimmedNamespace = (namespaceValue ?? '').trim();
  const [namespaceAvailability, setNamespaceAvailability] = useState<NamespaceAvailability>('idle');

  useEffect(() => {
    if (!isSetup || !isNamespaceFormatValid(trimmedNamespace)) {
      setNamespaceAvailability('idle');
      return;
    }
    setNamespaceAvailability('checking');
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const available = await checkCommunityWorkspaceNamespaceAvailable(trimmedNamespace);
        if (!cancelled) setNamespaceAvailability(available ? 'available' : 'taken');
      } catch {
        // Transient error — don't block; the setup mutation guards uniqueness.
        if (!cancelled) setNamespaceAvailability('idle');
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isSetup, trimmedNamespace]);

  const namespaceStatusNode = useMemo(() => {
    if (!isSetup || namespaceAvailability === 'idle') return null;
    const color = {
      available: cssVar.colorSuccess,
      checking: cssVar.colorTextSecondary,
      taken: cssVar.colorError,
    }[namespaceAvailability];
    return (
      <Flexbox horizontal align="center" gap={6} style={{ color, fontSize: 12 }}>
        {namespaceAvailability === 'checking' && <Icon spin icon={Loader2} size={13} />}
        {t(`user.workspaceProfile.fields.namespace.${namespaceAvailability}` as any)}
      </Flexbox>
    );
  }, [isSetup, namespaceAvailability, t]);

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
        console.error('[WorkspaceProfileModal] Avatar upload failed:', error);
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
        console.error('[WorkspaceProfileModal] Banner upload failed:', error);
        message.error(t('user.workspaceProfile.errors.uploadFailed'));
        options.onError?.(error as Error);
      } finally {
        setBannerUploading(false);
      }
    },
    [message, t, uploadWithProgress],
  );

  const handleSave = useCallback(async () => {
    if (loading) return;

    const values = await form.validateFields();

    if (isSetup && namespaceAvailability === 'taken') {
      message.error(t('user.workspaceProfile.fields.namespace.taken'));
      return;
    }

    setLoading(true);
    try {
      const profile = {
        avatarUrl,
        bannerUrl,
        description: trimOptional(values.description),
        displayName: values.displayName.trim(),
        websiteUrl: trimOptional(values.websiteUrl),
      };

      if (isSetup) {
        await setupCommunityWorkspaceProfile({
          ...profile,
          namespace: values.namespace!.trim(),
        });
      } else {
        await updateCommunityWorkspaceProfile(profile);
      }

      message.success(
        t(isSetup ? 'user.workspaceProfile.setup.success' : 'user.workspaceProfile.success'),
      );
      await onSuccess?.();
      close();
    } catch (error) {
      console.error('[WorkspaceProfileModal] Failed to update workspace profile:', error);
      // Surface a namespace conflict (e.g. the handle was claimed between the
      // live check and submit) as a taken-handle message instead of a generic one.
      if (isSetup && isCommunityWorkspaceNamespaceTakenError(error)) {
        setNamespaceAvailability('taken');
        message.error(t('user.workspaceProfile.fields.namespace.taken'));
      } else {
        message.error(
          t(isSetup ? 'user.workspaceProfile.setup.failed' : 'user.workspaceProfile.failed'),
        );
      }
    } finally {
      setLoading(false);
    }
  }, [
    avatarUrl,
    bannerUrl,
    close,
    form,
    isSetup,
    loading,
    message,
    namespaceAvailability,
    onSuccess,
    t,
  ]);

  const optionalItems = useMemo<CollapseProps['items']>(
    () => [
      {
        children: (
          <>
            <Form.Item
              label={t('user.workspaceProfile.fields.websiteUrl')}
              name="websiteUrl"
              rules={[{ message: t('user.workspaceProfile.errors.url'), type: 'url' }]}
            >
              <Input
                placeholder={t('user.workspaceProfile.fields.websiteUrl.placeholder')}
                prefix={
                  <Icon color={cssVar.colorTextSecondary} icon={Globe} style={{ marginRight: 8 }} />
                }
              />
            </Form.Item>

            <Form.Item
              label={
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
                      cursor: 'pointer',
                      height: 160,
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
                        e.currentTarget.style.opacity = '1';
                      }}
                      onMouseLeave={(e) => {
                        if (bannerUrl) e.currentTarget.style.opacity = '0';
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
                {bannerUrl && (
                  <Flexbox horizontal align="center" gap={8} justify="flex-end">
                    <Text
                      style={{
                        color: cssVar.colorError,
                        cursor: 'pointer',
                        fontSize: 12,
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setBannerUrl(null);
                      }}
                    >
                      <Flexbox horizontal align="center" gap={4}>
                        <Trash2 size={12} />
                        {t('user.workspaceProfile.fields.bannerUrl.remove')}
                      </Flexbox>
                    </Text>
                  </Flexbox>
                )}
              </Flexbox>
            </Form.Item>
          </>
        ),
        key: 'optional',
        label: t('user.workspaceProfile.optional.toggle'),
      },
    ],
    [bannerUploading, bannerUrl, handleBannerUpload, t],
  );

  return (
    <Flexbox gap={20} padding={24}>
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          description: user.description ?? undefined,
          displayName: user.displayName ?? user.userName ?? user.namespace,
          namespace: user.namespace || normalizeNamespace(user.displayName ?? user.userName ?? ''),
          websiteUrl: user.socialLinks?.website,
        }}
      >
        <Flexbox horizontal gap={24}>
          <Flexbox flex={1}>
            <Form.Item
              label={t('user.workspaceProfile.fields.displayName')}
              name="displayName"
              rules={[
                { message: t('user.workspaceProfile.errors.displayName'), required: true },
                { max: 50, message: t('user.workspaceProfile.fields.displayName.maxLength') },
              ]}
            >
              <Input
                showCount
                maxLength={50}
                placeholder={t('user.workspaceProfile.fields.displayName.placeholder')}
              />
            </Form.Item>
          </Flexbox>

          <Form.Item>
            <AvatarUpload
              allowDelete={!!avatarUrl}
              loading={avatarUploading}
              shape="square"
              size={80}
              value={avatarUrl || undefined}
              onDelete={() => setAvatarUrl(null)}
              onUpload={handleAvatarUpload}
            />
          </Form.Item>
        </Flexbox>

        {isSetup && (
          <Form.Item
            extra={namespaceStatusNode}
            label={t('user.workspaceProfile.fields.namespace')}
            name="namespace"
            rules={[
              { message: t('user.workspaceProfile.errors.namespace.required'), required: true },
              { max: 32, message: t('user.workspaceProfile.errors.namespace.length') },
              { min: 3, message: t('user.workspaceProfile.errors.namespace.length') },
              {
                message: t('user.workspaceProfile.errors.namespace.pattern'),
                pattern: /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/,
              },
            ]}
          >
            <AntInput
              showCount
              addonBefore={ORGANIZATION_URL_PREFIX}
              maxLength={32}
              placeholder={t('user.workspaceProfile.fields.namespace.placeholder')}
            />
          </Form.Item>
        )}

        <Form.Item
          label={t('user.workspaceProfile.fields.description')}
          name="description"
          rules={[{ max: 200, message: t('user.workspaceProfile.fields.description.maxLength') }]}
        >
          <TextArea
            showCount
            maxLength={200}
            placeholder={t('user.workspaceProfile.fields.description.placeholder')}
            rows={3}
          />
        </Form.Item>

        <Collapse
          defaultActiveKey={isSetup ? undefined : ['optional']}
          expandIconPlacement="end"
          items={optionalItems}
          size="small"
          variant="borderless"
          styles={{
            header: { cursor: 'pointer', width: '100%' },
            title: { cursor: 'pointer', width: '100%' },
          }}
        />
      </Form>

      <Flexbox horizontal gap={8} justify="flex-end">
        <Button disabled={loading} onClick={close}>
          {t('user.workspaceProfile.cancel')}
        </Button>
        <Button
          disabled={isSetup && namespaceAvailability === 'taken'}
          loading={loading}
          type="primary"
          onClick={handleSave}
        >
          {t(isSetup ? 'user.workspaceProfile.setup.save' : 'user.workspaceProfile.save')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

Content.displayName = 'WorkspaceProfileModalContent';
