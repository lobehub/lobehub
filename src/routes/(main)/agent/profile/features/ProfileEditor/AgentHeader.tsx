'use client';

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
  // Without edit rights there is nothing to prompt for, so a nameless agent
  // falls back to the plain label rather than showing an action nobody can take.
  const showNamePrompt = !meta.name?.trim() && canEdit;

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
        {/* The headline is the NAME slot. It does not borrow the role the way
            list surfaces do — the role has its own line right below, and falling
            back would print it twice (an agent titled "Lobe AI" read
            "Lobe AI / Lobe AI · @inbox").

            With no name there is nothing to headline, so the slot carries the
            one thing that can fix it instead of a placeholder pretending to be a
            name. The edit affordance stays hidden until then: naming it IS the
            next step, and offering the full identity form alongside would split
            attention between two ways to do the same thing. */}
        {showNamePrompt ? (
          <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
            <Text ellipsis style={{ color: cssVar.colorTextTertiary, fontSize: 20 }}>
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
        ) : (
          <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
            <Text ellipsis style={{ fontSize: 36, fontWeight: 600 }}>
              {meta.name?.trim() || t('settingAgent.identity.untitled', { ns: 'setting' })}
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
        )}
        <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
          {/* `Text type="secondary"` resolves to `colorTextDescription`, which antd
              maps to the TERTIARY step — too faint for the line that carries the
              agent's role. Set the secondary colour explicitly, and leave only
              the decorative `@` and the separator at tertiary. */}
          {/* The role always occupies its slot. An agent with no role gets a
              stated placeholder rather than a gap — otherwise the line silently
              collapses to a bare slug and the missing role is indistinguishable
              from a role that was never meant to be there. */}
          <Text
            ellipsis
            style={{
              color: meta.title?.trim() ? cssVar.colorTextSecondary : cssVar.colorTextTertiary,
            }}
          >
            {meta.title?.trim() || t('settingAgent.role.unset', { ns: 'setting' })}
          </Text>
          {slug ? <Text style={{ color: cssVar.colorTextTertiary }}>·</Text> : null}
          {/* The tooltip only renders when a slug exists, so it can always name
              the real url rather than a `<slug>` the reader has to substitute. */}
          {slug ? (
            <Tooltip title={t('settingAgent.slug.openWith', { ns: 'setting', slug })}>
              <Text code style={{ color: cssVar.colorTextSecondary, flex: 'none' }}>
                <span style={{ color: cssVar.colorTextTertiary }}>@</span>
                {slug}
              </Text>
            </Tooltip>
          ) : null}
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
});

export default AgentHeader;
