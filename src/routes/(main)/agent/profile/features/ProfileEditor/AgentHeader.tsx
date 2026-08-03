'use client';

import { EDITOR_DEBOUNCE_TIME } from '@lobechat/const';
import { ActionIcon, Flexbox, Icon, Input, Skeleton, Text, Tooltip } from '@lobehub/ui';
import { toast } from '@lobehub/ui/base-ui';
import { debounce } from 'es-toolkit/compat';
import isEqual from 'fast-deep-equal';
import { CheckIcon, PaletteIcon, PencilIcon } from 'lucide-react';
import { memo, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import EmojiPicker from '@/components/EmojiPicker';
import BackgroundSwatches from '@/features/AgentSetting/AgentMeta/BackgroundSwatches';
import { usePermission } from '@/hooks/usePermission';
import { agentService } from '@/services/agent';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useFileStore } from '@/store/file';
import { useGlobalStore } from '@/store/global';
import { globalGeneralSelectors } from '@/store/global/selectors';

const MAX_AVATAR_SIZE = 1024 * 1024; // 1MB limit for server actions

const AgentHeader = memo(() => {
  const { t } = useTranslation(['setting', 'common']);
  const locale = useGlobalStore(globalGeneralSelectors.currentLanguage);
  const { allowed: canEdit } = usePermission('edit_own_content');

  const agentId = useAgentStore((s) => s.activeAgentId || '');
  const meta = useAgentStore(agentSelectors.getAgentMetaById(agentId), isEqual);
  const slug = useAgentStore(agentSelectors.getAgentSlugById(agentId));
  const updateMetaById = useAgentStore((s) => s.updateAgentMetaById);
  const refreshAgentConfig = useAgentStore((s) => s.internal_refreshAgentConfig);

  // File upload
  const uploadWithProgress = useFileStore((s) => s.uploadWithProgress);
  const [uploading, setUploading] = useState(false);

  // Identity is read-only until the user opts into editing — three always-on
  // inputs made a settled profile look like an unsaved form.
  const [editing, setEditing] = useState(false);

  // Local state for inputs (to avoid stuttering during typing)
  const [localTitle, setLocalTitle] = useState(meta.title || '');
  const [localName, setLocalName] = useState(meta.name || '');
  // The slug is not part of the meta patch — it has its own validated endpoint —
  // so it commits on blur rather than on every keystroke.
  const [localSlug, setLocalSlug] = useState(slug || '');
  const [slugError, setSlugError] = useState<string | undefined>();

  // Sync local state when meta changes from external source
  useEffect(() => {
    setLocalTitle(meta.title || '');
  }, [agentId, meta.title]);

  useEffect(() => {
    setLocalName(meta.name || '');
  }, [agentId, meta.name]);

  useEffect(() => {
    setLocalSlug(slug || '');
    setSlugError(undefined);
  }, [agentId, slug]);

  useEffect(() => {
    setEditing(false);
  }, [agentId]);

  const commitSlug = useCallback(async () => {
    const next = localSlug.trim().toLowerCase();
    if (!agentId || !canEdit || !next || next === (slug || '')) {
      setSlugError(undefined);
      return;
    }

    const result = await agentService.updateAgentSlug(agentId, next);
    if (result.success) {
      setSlugError(undefined);
      await refreshAgentConfig(agentId);
      return;
    }

    setSlugError(t(`settingAgent.slug.error.${result.reason ?? 'invalid'}`, { ns: 'setting' }));
  }, [agentId, canEdit, localSlug, refreshAgentConfig, slug, t]);

  // Debounced save for title
  const debouncedSaveTitle = useMemo(
    () =>
      debounce((targetAgentId: string, value: string) => {
        updateMetaById(targetAgentId, { title: value });
      }, EDITOR_DEBOUNCE_TIME),
    [updateMetaById],
  );

  const debouncedSaveName = useMemo(
    () =>
      debounce((targetAgentId: string, value: string) => {
        updateMetaById(targetAgentId, { name: value });
      }, EDITOR_DEBOUNCE_TIME),
    [updateMetaById],
  );

  // A pending edit belongs to the agent that was being edited. Commit that
  // invocation before adopting another agent's local input state.
  useEffect(
    () => () => {
      debouncedSaveTitle.flush();
      debouncedSaveTitle.cancel();
      debouncedSaveName.flush();
      debouncedSaveName.cancel();
    },
    [agentId, debouncedSaveName, debouncedSaveTitle],
  );

  // Handle avatar change (immediate save)
  const handleAvatarChange = (emoji: string) => {
    if (!canEdit) return;

    updateMetaById(agentId, { avatar: emoji });
  };

  // Handle avatar upload
  const handleAvatarUpload = useCallback(
    async (file: File) => {
      if (!canEdit) return;

      if (file.size > MAX_AVATAR_SIZE) {
        toast.error(t('settingAgent.avatar.sizeExceeded', { ns: 'setting' }));
        return;
      }

      setUploading(true);
      try {
        const result = await uploadWithProgress({ file });
        if (result?.url) {
          updateMetaById(agentId, { avatar: result.url });
        }
      } finally {
        setUploading(false);
      }
    },
    [agentId, canEdit, uploadWithProgress, updateMetaById, t],
  );

  // Handle avatar delete
  const handleAvatarDelete = useCallback(() => {
    if (!canEdit) return;

    updateMetaById(agentId, { avatar: null });
  }, [agentId, canEdit, updateMetaById]);

  // Handle background color change (immediate save)
  const handleBackgroundColorChange = (color?: string) => {
    if (!canEdit) return;

    if (color !== undefined) {
      updateMetaById(agentId, { backgroundColor: color });
    }
  };

  return (
    <Flexbox
      gap={16}
      paddingBlock={16}
      style={{
        cursor: 'default',
      }}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
    >
      {/* Avatar Section */}
      <EmojiPicker
        allowModelAvatar
        allowDelete={canEdit && !!meta.avatar}
        allowUpload={canEdit}
        loading={uploading}
        locale={locale}
        open={canEdit ? undefined : false}
        shape={'square'}
        size={72}
        value={meta.avatar}
        background={
          meta.backgroundColor && meta.backgroundColor !== 'rgba(0,0,0,0)'
            ? meta.backgroundColor
            : undefined
        }
        customTabs={[
          {
            label: (
              <Tooltip title={t('settingAgent.backgroundColor.title', { ns: 'setting' })}>
                <Icon icon={PaletteIcon} size={{ size: 20, strokeWidth: 2.5 }} />
              </Tooltip>
            ),
            render: () => (
              <Flexbox padding={8} width={332}>
                <Suspense
                  fallback={
                    <Flexbox gap={8}>
                      <Skeleton.Button block style={{ height: 38 }} />
                      <Skeleton.Button block style={{ height: 38 }} />
                    </Flexbox>
                  }
                >
                  <BackgroundSwatches
                    disabled={!canEdit}
                    gap={8}
                    shape={'square'}
                    size={38}
                    value={meta.backgroundColor}
                    onChange={handleBackgroundColorChange}
                  />
                </Suspense>
              </Flexbox>
            ),
            value: 'background',
          },
        ]}
        popupProps={{
          placement: 'bottomLeft',
        }}
        onChange={handleAvatarChange}
        onDelete={handleAvatarDelete}
        onUpload={handleAvatarUpload}
      />
      {/* Identity Section — name is the headline; role and slug sit together under
          it. Read-only until the pencil is clicked, so a settled profile doesn't
          read as an unsaved form. */}
      <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
        {editing ? (
          <>
            <Flexbox horizontal align={'center'} gap={4} style={{ minWidth: 0 }}>
              <Input
                autoFocus
                placeholder={t('settingAgent.personalName.placeholder', { ns: 'setting' })}
                style={{ flex: 1, fontSize: 36, fontWeight: 600, padding: 0 }}
                value={localName}
                variant={'borderless'}
                onChange={(e) => {
                  setLocalName(e.target.value);
                  if (!agentId) return;

                  debouncedSaveName(agentId, e.target.value);
                }}
              />
              <ActionIcon
                icon={CheckIcon}
                size={'small'}
                title={t('settingAgent.identity.done', { ns: 'setting' })}
                onClick={() => {
                  void commitSlug();
                  setEditing(false);
                }}
              />
            </Flexbox>
            {/* Left-aligned and compact: a stretching role input would push the slug
                back to the far edge, which is exactly what the grouped layout fixes. */}
            <Flexbox horizontal align={'center'} gap={12} style={{ minWidth: 0 }}>
              <Flexbox horizontal align={'center'} gap={8} style={{ flex: 'none', minWidth: 0 }}>
                <Text style={{ flex: 'none' }} type={'secondary'}>
                  {t('settingAgent.role.label', { ns: 'setting' })}
                </Text>
                <Input
                  placeholder={t('settingAgent.role.placeholder', { ns: 'setting' })}
                  style={{ padding: 0, width: 220 }}
                  value={localTitle}
                  variant={'borderless'}
                  onChange={(e) => {
                    setLocalTitle(e.target.value);
                    if (!agentId) return;

                    debouncedSaveTitle(agentId, e.target.value);
                  }}
                />
              </Flexbox>
              <Flexbox horizontal align={'center'} gap={4} style={{ flex: 'none' }}>
                <Text type={'secondary'}>@</Text>
                <Input
                  placeholder={t('settingAgent.slug.placeholder', { ns: 'setting' })}
                  status={slugError ? 'error' : undefined}
                  style={{ padding: 0, width: 180 }}
                  value={localSlug}
                  variant={'borderless'}
                  onBlur={() => void commitSlug()}
                  onChange={(e) => {
                    setLocalSlug(e.target.value);
                    setSlugError(undefined);
                  }}
                />
              </Flexbox>
            </Flexbox>
            {slugError ? (
              <Text style={{ fontSize: 12 }} type={'danger'}>
                {slugError}
              </Text>
            ) : null}
          </>
        ) : (
          <>
            <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
              <Text ellipsis style={{ fontSize: 36, fontWeight: 600 }}>
                {meta.name?.trim() ||
                  meta.title?.trim() ||
                  t('settingAgent.personalName.placeholder', { ns: 'setting' })}
              </Text>
              {canEdit ? (
                <ActionIcon
                  icon={PencilIcon}
                  size={'small'}
                  title={t('settingAgent.identity.edit', { ns: 'setting' })}
                  onClick={() => setEditing(true)}
                />
              ) : null}
            </Flexbox>
            <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
              {meta.title?.trim() ? (
                <Text ellipsis type={'secondary'}>
                  {meta.title}
                </Text>
              ) : null}
              {meta.title?.trim() && slug ? <Text type={'secondary'}>·</Text> : null}
              {slug ? (
                <Tooltip title={t('settingAgent.slug.tooltip', { ns: 'setting' })}>
                  <Text code style={{ flex: 'none' }} type={'secondary'}>
                    @{slug}
                  </Text>
                </Tooltip>
              ) : null}
            </Flexbox>
          </>
        )}
      </Flexbox>
    </Flexbox>
  );
});

export default AgentHeader;
