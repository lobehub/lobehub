'use client';

import { agentDisplayName } from '@lobechat/types';
import { ActionIcon, Flexbox, Icon, Skeleton, Text, Tooltip } from '@lobehub/ui';
import { Button, toast } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { PaletteIcon, PencilIcon, SparklesIcon } from 'lucide-react';
import { memo, Suspense, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import EmojiPicker from '@/components/EmojiPicker';
import { createAgentIdentityModal } from '@/features/AgentIdentityModal';
import BackgroundSwatches from '@/features/AgentSetting/AgentMeta/BackgroundSwatches';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useFileStore } from '@/store/file';
import { useGlobalStore } from '@/store/global';
import { globalGeneralSelectors } from '@/store/global/selectors';

import { useAutoName } from './useAutoName';

const MAX_AVATAR_SIZE = 1024 * 1024; // 1MB limit for server actions

const AgentHeader = memo(() => {
  const { t } = useTranslation(['setting', 'common']);
  const locale = useGlobalStore(globalGeneralSelectors.currentLanguage);
  const { allowed: canEdit } = usePermission('edit_own_content');

  const agentId = useAgentStore((s) => s.activeAgentId || '');
  const meta = useAgentStore(agentSelectors.getAgentMetaById(agentId), isEqual);
  const slug = useAgentStore(agentSelectors.getAgentSlugById(agentId));
  const updateMetaById = useAgentStore((s) => s.updateAgentMetaById);
  const { autoName, naming } = useAutoName(agentId);
  const isUnnamed = !meta.name?.trim();

  // File upload
  const uploadWithProgress = useFileStore((s) => s.uploadWithProgress);
  const [uploading, setUploading] = useState(false);

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
      {/* Identity Section — display only. Editing all three fields happens in a
          form modal; inline inputs crowded the header and left no room for a
          per-field label or error. */}
      <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
        <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
          {/* Never fall back to the name field's PLACEHOLDER here — it reads as
              though the agent were literally called "Give it a name, e.g. Alice".
              An agent with neither name nor role gets the plain unnamed label,
              and the prompt to name it lives on its own line below. */}
          <Text ellipsis style={{ fontSize: 36, fontWeight: 600 }}>
            {agentDisplayName(meta, t('settingAgent.identity.untitled', { ns: 'setting' }))}
          </Text>
          {canEdit ? (
            <ActionIcon
              icon={PencilIcon}
              size={'small'}
              title={t('settingAgent.identity.edit', { ns: 'setting' })}
              onClick={() => createAgentIdentityModal(agentId)}
            />
          ) : null}
        </Flexbox>
        <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
          {/* `Text type="secondary"` resolves to `colorTextDescription`, which antd
              maps to the TERTIARY step — too faint for the line that carries the
              agent's role. Set the secondary colour explicitly, and leave only
              the decorative `@` and the separator at tertiary. */}
          {meta.title?.trim() ? (
            <Text ellipsis style={{ color: cssVar.colorTextSecondary }}>
              {meta.title}
            </Text>
          ) : null}
          {meta.title?.trim() && slug ? (
            <Text style={{ color: cssVar.colorTextTertiary }}>·</Text>
          ) : null}
          {slug ? (
            <Tooltip title={t('settingAgent.slug.tooltip', { ns: 'setting' })}>
              <Text code style={{ color: cssVar.colorTextSecondary, flex: 'none' }}>
                <span style={{ color: cssVar.colorTextTertiary }}>@</span>
                {slug}
              </Text>
            </Tooltip>
          ) : null}
        </Flexbox>
        {/* A nameless agent is the one state the header can actually fix, so it
            says so and offers the fix inline rather than sending the user into
            the form to invent a name on the spot. */}
        {isUnnamed && canEdit ? (
          <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
            <Text ellipsis style={{ color: cssVar.colorTextTertiary, fontSize: 12 }}>
              {t('settingAgent.personalName.unnamed', { ns: 'setting' })}
            </Text>
            <Button
              icon={SparklesIcon}
              loading={naming}
              size={'small'}
              type={'text'}
              onClick={() => {
                void autoName();
              }}
            >
              {t('settingAgent.personalName.pickForMe', { ns: 'setting' })}
            </Button>
          </Flexbox>
        ) : null}
      </Flexbox>
    </Flexbox>
  );
});

export default AgentHeader;
