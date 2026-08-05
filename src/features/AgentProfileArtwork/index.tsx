'use client';

import { ActionIcon, Center, Flexbox, Icon, Skeleton, Text, Tooltip } from '@lobehub/ui';
import { Button, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ImagePlus, SparklesIcon, Trash2, UploadIcon } from 'lucide-react';
import { memo, Suspense, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import EmojiPicker from '@/components/EmojiPicker';
import { useFileStore } from '@/store/file';

import { useGenerateAgentArtwork } from './useGenerateAgentArtwork';
import { buildAgentArtworkPrompt, resolveAgentBackground } from './utils';

const MAX_ARTWORK_SIZE = 1024 * 1024;

const styles = createStaticStyles(({ css }) => ({
  avatar: css`
    position: absolute;
    z-index: 2;
    inset-block-end: 0;
    inset-inline-start: 24px;

    border: 4px solid ${cssVar.colorBgContainer};
    border-radius: calc(${cssVar.borderRadiusLG} + 4px);

    background: ${cssVar.colorBgContainer};
  `,
  background: css`
    position: relative;

    overflow: hidden;

    width: 100%;
    height: 160px;
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorFillTertiary};
    background-position: center;
    background-size: cover;
  `,
  backgroundActions: css`
    position: absolute;
    z-index: 2;
    inset-block-start: 12px;
    inset-inline-end: 12px;

    opacity: 0;

    transition: opacity ${cssVar.motionDurationFast};

    .agent-background:hover &,
    .agent-background:focus-within & {
      opacity: 1;
    }
  `,
  emptyBackground: css`
    color: ${cssVar.colorTextTertiary};
  `,
  generatedAction: css`
    width: 100%;
  `,
  scrim: css`
    position: absolute;
    inset: 0;
    background: linear-gradient(to bottom, transparent 45%, rgb(0 0 0 / 16%));
  `,
}));

interface AgentProfileArtworkProps {
  avatar?: string | null;
  background?: string | null;
  canEdit: boolean;
  description?: string | null;
  locale: string;
  name?: string | null;
  onAvatarChange: (avatar: string | null) => void;
  onBackgroundChange: (background: string | null) => void;
  systemRole?: string | null;
  title?: string | null;
}

export const AgentProfileArtwork = memo<AgentProfileArtworkProps>(
  ({
    avatar,
    background,
    canEdit,
    description,
    locale,
    name,
    systemRole,
    title,
    onAvatarChange,
    onBackgroundChange,
  }) => {
    const { t } = useTranslation('setting');
    const uploadWithProgress = useFileStore((s) => s.uploadWithProgress);
    const { canGenerate, generate } = useGenerateAgentArtwork();
    const backgroundInputRef = useRef<HTMLInputElement>(null);
    const [avatarUploading, setAvatarUploading] = useState(false);
    const [backgroundUploading, setBackgroundUploading] = useState(false);
    const [generating, setGenerating] = useState<'avatar' | 'background' | null>(null);
    const backgroundUrl = resolveAgentBackground(background);

    const upload = useCallback(
      async (kind: 'avatar' | 'background', file: File) => {
        if (!canEdit) return;
        if (file.size > MAX_ARTWORK_SIZE) {
          toast.error(t('settingAgent.artwork.sizeExceeded'));
          return;
        }

        const setUploading = kind === 'avatar' ? setAvatarUploading : setBackgroundUploading;
        setUploading(true);
        try {
          const result = await uploadWithProgress({ file });
          if (!result?.url) throw new Error('Upload returned no URL');
          if (kind === 'avatar') onAvatarChange(result.url);
          else onBackgroundChange(result.url);
        } catch (error) {
          console.error('Failed to upload agent artwork:', error);
          toast.error(t('settingAgent.artwork.uploadFailed'));
        } finally {
          setUploading(false);
        }
      },
      [canEdit, onAvatarChange, onBackgroundChange, t, uploadWithProgress],
    );

    const generateArtwork = useCallback(
      async (kind: 'avatar' | 'background') => {
        if (!canEdit || !canGenerate) return;

        setGenerating(kind);
        try {
          const url = await generate(
            kind,
            buildAgentArtworkPrompt({ description, kind, name, systemRole, title }),
          );
          if (kind === 'avatar') onAvatarChange(url);
          else onBackgroundChange(url);
        } catch (error) {
          console.error('Failed to generate agent artwork:', error);
          toast.error(t('settingAgent.artwork.generateFailed'));
        } finally {
          setGenerating(null);
        }
      },
      [
        canEdit,
        canGenerate,
        description,
        generate,
        name,
        onAvatarChange,
        onBackgroundChange,
        systemRole,
        t,
        title,
      ],
    );

    return (
      <div style={{ paddingBlockEnd: 36, position: 'relative' }}>
        <div
          className={`${styles.background} agent-background`}
          style={{ backgroundImage: backgroundUrl ? `url(${backgroundUrl})` : undefined }}
        >
          {backgroundUrl ? <div className={styles.scrim} /> : null}
          {!backgroundUrl ? (
            <Center className={styles.emptyBackground} height={'100%'}>
              <Flexbox horizontal align={'center'} gap={8}>
                <ImagePlus size={18} />
                <Text>{t('settingAgent.artwork.background.empty')}</Text>
              </Flexbox>
            </Center>
          ) : null}
          {canEdit ? (
            <Flexbox
              horizontal
              className={styles.backgroundActions}
              gap={4}
              style={{ opacity: backgroundUrl ? undefined : 1 }}
            >
              <Tooltip title={t('settingAgent.artwork.background.upload')}>
                <ActionIcon
                  glass
                  icon={UploadIcon}
                  loading={backgroundUploading}
                  onClick={() => backgroundInputRef.current?.click()}
                />
              </Tooltip>
              {canGenerate ? (
                <Tooltip title={t('settingAgent.artwork.background.generate')}>
                  <ActionIcon
                    glass
                    icon={SparklesIcon}
                    loading={generating === 'background'}
                    onClick={() => void generateArtwork('background')}
                  />
                </Tooltip>
              ) : null}
              {backgroundUrl ? (
                <Tooltip title={t('settingAgent.artwork.background.remove')}>
                  <ActionIcon glass icon={Trash2} onClick={() => onBackgroundChange(null)} />
                </Tooltip>
              ) : null}
            </Flexbox>
          ) : null}
          <input
            hidden
            accept="image/*"
            ref={backgroundInputRef}
            type="file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void upload('background', file);
            }}
          />
        </div>
        <div className={styles.avatar}>
          <EmojiPicker
            allowModelAvatar
            allowDelete={canEdit && !!avatar}
            allowUpload={canEdit}
            loading={avatarUploading || generating === 'avatar'}
            locale={locale}
            open={canEdit ? undefined : false}
            popupProps={{ placement: 'bottomLeft' }}
            shape={'square'}
            size={72}
            value={avatar || undefined}
            customTabs={
              canGenerate
                ? [
                    {
                      label: (
                        <Tooltip title={t('settingAgent.artwork.avatar.generate')}>
                          <Icon icon={SparklesIcon} size={{ size: 20, strokeWidth: 2.5 }} />
                        </Tooltip>
                      ),
                      render: () => (
                        <Flexbox padding={12} width={332}>
                          <Suspense fallback={<Skeleton.Button block />}>
                            <Button
                              className={styles.generatedAction}
                              icon={SparklesIcon}
                              loading={generating === 'avatar'}
                              onClick={() => void generateArtwork('avatar')}
                            >
                              {t('settingAgent.artwork.avatar.generateAction')}
                            </Button>
                          </Suspense>
                        </Flexbox>
                      ),
                      value: 'generate',
                    },
                  ]
                : undefined
            }
            onChange={(value) => onAvatarChange(value)}
            onDelete={() => onAvatarChange(null)}
            onUpload={(file) => upload('avatar', file)}
          />
        </div>
      </div>
    );
  },
);

AgentProfileArtwork.displayName = 'AgentProfileArtwork';

export { buildAgentArtworkPrompt, resolveAgentBackground } from './utils';
