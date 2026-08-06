'use client';

import { ActionIcon, Alert, Avatar, Center, Flexbox, Icon, Text, Tooltip } from '@lobehub/ui';
import { Button, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ImageIcon, Trash2, UploadIcon, WandSparkles } from 'lucide-react';
import { memo, useCallback, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import EmojiPicker from '@/components/EmojiPicker';
import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { useAgentStore } from '@/store/agent';
import { agentArtworkSelectors } from '@/store/agent/selectors';
import { useAiInfraStore } from '@/store/aiInfra';
import { aiProviderSelectors } from '@/store/aiInfra/selectors';
import { useFileStore } from '@/store/file';

import { openFilePicker, resolveAgentBackground } from './utils';

const MAX_ARTWORK_SIZE = 1024 * 1024;

const styles = createStaticStyles(({ css }) => ({
  avatar: css`
    position: absolute;
    z-index: 4;
    inset-block-end: 0;
    inset-inline-start: 24px;

    border: 4px solid ${cssVar.colorBgContainer};
    border-radius: calc(${cssVar.borderRadiusLG} + 4px);

    background: ${cssVar.colorBgContainer};

    .ant-avatar:focus {
      outline: none;
    }
  `,
  avatarGenerating: css`
    pointer-events: none;

    position: absolute;
    z-index: 3;
    inset: 4px;

    border-radius: ${cssVar.borderRadiusLG};

    background: color-mix(in srgb, ${cssVar.colorBgContainer} 82%, transparent);
    backdrop-filter: blur(8px);
  `,
  background: css`
    position: relative;

    overflow: hidden;

    width: calc(100% + 32px);
    height: 160px;
    margin-inline: -16px;
    border-radius: ${cssVar.borderRadiusLG};

    background: transparent;
    background-position: center;
    background-size: cover;

    transition: height ${cssVar.motionDurationMid};
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
  avatarPicker: css`
    .ant-tabs-tab:has([id$='-tab-generate']) {
      order: -1;
    }
  `,
  compactBackground: css`
    height: 80px;
  `,
  emptyBackgroundActions: css`
    position: absolute;
    inset: 0;
    opacity: 0;
    transition: opacity ${cssVar.motionDurationFast};

    .agent-background:hover &,
    .agent-background:focus-within & {
      opacity: 1;
    }
  `,
  emptyBackgroundHint: css`
    color: ${cssVar.colorTextSecondary};
  `,
  generatedAction: css`
    width: 100%;
  `,
  generatedPreview: css`
    position: relative;

    overflow: hidden;

    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorFillQuaternary};
  `,
  generationFeedback: css`
    position: absolute;
    z-index: 3;
    inset: 0;

    padding: 16px;

    color: ${cssVar.colorText};

    background: color-mix(in srgb, ${cssVar.colorBgContainer} 88%, transparent);
    backdrop-filter: blur(12px);
  `,
  generationHint: css`
    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
    text-align: center;
  `,
  generationActions: css`
    margin-block-start: 4px;
  `,
  generationTitle: css`
    font-weight: 500;
  `,
  previewGenerationFeedback: css`
    inset: 1px;
    border-radius: calc(${cssVar.borderRadiusLG} - 1px);
  `,
  visuallyHiddenInput: css`
    pointer-events: none;

    position: fixed;

    overflow: hidden;

    width: 1px;
    height: 1px;

    opacity: 0;
  `,
  scrim: css`
    position: absolute;
    inset: 0;
    background: linear-gradient(to bottom, transparent 45%, rgb(0 0 0 / 16%));
  `,
}));

interface AgentProfileArtworkProps {
  agentId: string;
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
    agentId,
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
    const canGenerate = useAiInfraStore(
      (state) => aiProviderSelectors.enabledImageModelList(state).length > 0,
    );
    const generateAgentArtwork = useAgentStore((s) => s.generateAgentArtwork);
    const cancelAgentArtworkGeneration = useAgentStore((s) => s.cancelAgentArtworkGeneration);
    const generation = useAgentStore(agentArtworkSelectors.generationByAgentId(agentId));
    const backgroundInputRef = useRef<HTMLInputElement>(null);
    const backgroundInputId = useId();
    const [avatarUploading, setAvatarUploading] = useState(false);
    const [backgroundUploading, setBackgroundUploading] = useState(false);
    const generating = generation?.status === 'generating' ? generation.kind : null;
    const generationError = generation?.status === 'error' ? generation.kind : null;
    const backgroundGenerationActive = generation?.kind === 'background';
    const backgroundUrl = resolveAgentBackground(background);

    const openBackgroundFilePicker = useCallback(() => {
      const input = backgroundInputRef.current;
      if (!input) return;

      openFilePicker(input);
    }, []);

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

        try {
          await generateAgentArtwork({
            description,
            id: agentId,
            kind,
            name,
            referenceImageUrl: kind === 'background' ? avatar : backgroundUrl,
            systemRole,
            title,
          });
        } catch {
          // The Agent store owns the persistent error state rendered below.
        }
      },
      [
        agentId,
        avatar,
        backgroundUrl,
        canEdit,
        canGenerate,
        description,
        generateAgentArtwork,
        name,
        systemRole,
        title,
      ],
    );

    return (
      <div style={{ paddingBlockEnd: 36, position: 'relative' }}>
        <div
          className={`${styles.background} ${!backgroundUrl && !backgroundGenerationActive ? styles.compactBackground : ''} agent-background`}
          style={{ backgroundImage: backgroundUrl ? `url(${backgroundUrl})` : undefined }}
        >
          {backgroundUrl ? <div className={styles.scrim} /> : null}
          {generating === 'background' ? (
            <Center className={styles.generationFeedback}>
              <Flexbox align={'center'} gap={10}>
                <NeuralNetworkLoading size={32} />
                <Flexbox align={'center'} gap={4}>
                  <Text className={styles.generationTitle}>
                    {t('settingAgent.artwork.background.generating')}
                  </Text>
                  <Text className={styles.generationHint}>
                    {t('settingAgent.artwork.generatingHint')}
                  </Text>
                  <Button
                    className={styles.generationActions}
                    size={'small'}
                    type={'fill'}
                    onClick={() => void cancelAgentArtworkGeneration(agentId)}
                  >
                    {t('settingAgent.artwork.cancel')}
                  </Button>
                </Flexbox>
              </Flexbox>
            </Center>
          ) : generationError === 'background' ? (
            <Center className={styles.generationFeedback}>
              <Flexbox align={'center'} gap={10}>
                <Text>{t('settingAgent.artwork.generateFailed')}</Text>
                <Button
                  icon={WandSparkles}
                  size={'small'}
                  onClick={() => void generateArtwork('background')}
                >
                  {t('settingAgent.artwork.retry')}
                </Button>
              </Flexbox>
            </Center>
          ) : null}
          {!backgroundUrl && canEdit && !backgroundGenerationActive ? (
            <Center className={styles.emptyBackgroundActions}>
              <Flexbox align={'center'} gap={8}>
                <Text className={styles.emptyBackgroundHint}>
                  {t('settingAgent.artwork.background.emptyHint')}
                </Text>
                <Flexbox horizontal gap={8}>
                  <Button
                    icon={UploadIcon}
                    loading={backgroundUploading}
                    size={'small'}
                    onClick={openBackgroundFilePicker}
                  >
                    {t('settingAgent.artwork.background.upload')}
                  </Button>
                  {canGenerate ? (
                    <Button
                      icon={WandSparkles}
                      loading={generating === 'background'}
                      size={'small'}
                      onClick={() => void generateArtwork('background')}
                    >
                      {t('settingAgent.artwork.background.generate')}
                    </Button>
                  ) : null}
                </Flexbox>
              </Flexbox>
            </Center>
          ) : null}
          {canEdit && !backgroundGenerationActive ? (
            <Flexbox
              horizontal
              className={styles.backgroundActions}
              gap={4}
              style={{ display: backgroundUrl ? undefined : 'none' }}
            >
              <Tooltip title={t('settingAgent.artwork.background.upload')}>
                <ActionIcon
                  glass
                  icon={UploadIcon}
                  loading={backgroundUploading}
                  onClick={openBackgroundFilePicker}
                />
              </Tooltip>
              {canGenerate ? (
                <Tooltip title={t('settingAgent.artwork.background.generate')}>
                  <ActionIcon
                    glass
                    icon={WandSparkles}
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
        </div>
        <div className={styles.avatar}>
          <EmojiPicker
            allowModelAvatar
            allowDelete={canEdit && !!avatar}
            allowUpload={canEdit}
            loading={avatarUploading}
            locale={locale}
            open={canEdit ? undefined : false}
            popupClassName={`${styles.avatarPicker} agent-avatar-artwork-picker`}
            popupProps={{ placement: 'bottomLeft' }}
            shape={'square'}
            size={72}
            value={avatar || undefined}
            customTabs={
              canGenerate
                ? [
                    {
                      label: (
                        <Tooltip title={t('settingAgent.artwork.avatar.image')}>
                          <Icon icon={ImageIcon} size={{ size: 20, strokeWidth: 2.5 }} />
                        </Tooltip>
                      ),
                      render: () => (
                        <Flexbox gap={16} padding={20} width={348}>
                          <Center className={styles.generatedPreview} height={156}>
                            <Avatar avatar={avatar || undefined} shape={'square'} size={112} />
                            {generating === 'avatar' ? (
                              <Center
                                className={`${styles.generationFeedback} ${styles.previewGenerationFeedback}`}
                              >
                                <Flexbox align={'center'} gap={10}>
                                  <NeuralNetworkLoading size={32} />
                                  <Flexbox align={'center'} gap={4}>
                                    <Text className={styles.generationTitle}>
                                      {t('settingAgent.artwork.avatar.generating')}
                                    </Text>
                                    <Text className={styles.generationHint}>
                                      {t('settingAgent.artwork.generatingHint')}
                                    </Text>
                                    <Button
                                      className={styles.generationActions}
                                      size={'small'}
                                      type={'fill'}
                                      onClick={() => void cancelAgentArtworkGeneration(agentId)}
                                    >
                                      {t('settingAgent.artwork.cancel')}
                                    </Button>
                                  </Flexbox>
                                </Flexbox>
                              </Center>
                            ) : null}
                          </Center>
                          {generating !== 'avatar' ? (
                            <Button
                              className={styles.generatedAction}
                              icon={WandSparkles}
                              onClick={() => void generateArtwork('avatar')}
                            >
                              {t('settingAgent.artwork.avatar.generateAction')}
                            </Button>
                          ) : null}
                          {generationError === 'avatar' ? (
                            <Alert
                              showIcon
                              title={t('settingAgent.artwork.generateFailed')}
                              type={'error'}
                            />
                          ) : null}
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
            onOpenChange={(open) => {
              if (!open || !canGenerate) return;

              requestAnimationFrame(() => {
                const tabs = document.querySelectorAll('.agent-avatar-artwork-picker [role="tab"]');
                (tabs.item(tabs.length - 1) as HTMLElement | null)?.click();
              });
            }}
          />
          {generating === 'avatar' ? (
            <Center className={styles.avatarGenerating}>
              <NeuralNetworkLoading size={28} />
            </Center>
          ) : null}
        </div>
        <input
          accept="image/*"
          aria-label={t('settingAgent.artwork.background.upload')}
          className={styles.visuallyHiddenInput}
          id={backgroundInputId}
          ref={backgroundInputRef}
          tabIndex={-1}
          type="file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void upload('background', file);
          }}
        />
      </div>
    );
  },
);

AgentProfileArtwork.displayName = 'AgentProfileArtwork';

export { resolveAgentBackground } from './utils';
