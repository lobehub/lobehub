'use client';

import {
  AGENT_ARTWORK_STYLES,
  type AgentArtworkStyle,
  DEFAULT_AGENT_ARTWORK_STYLE,
} from '@lobechat/prompts';
import { ActionIcon, Avatar, Center, Flexbox, Icon, Text, Tooltip } from '@lobehub/ui';
import { Button, type DropdownItem, DropdownMenu, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Check, ImageIcon, MoreHorizontal, Trash2, UploadIcon, WandSparkles } from 'lucide-react';
import { memo, useCallback, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import EmojiPicker from '@/components/EmojiPicker';
import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import {
  openAgentArtworkStudio,
  styleReferencesForArtworkStyle,
} from '@/features/AgentArtworkStudio';
import { useAgentStore } from '@/store/agent';
import { agentArtworkSelectors } from '@/store/agent/selectors';
import { useAiInfraStore } from '@/store/aiInfra';
import { aiProviderSelectors } from '@/store/aiInfra/selectors';
import { useFileStore } from '@/store/file';

import { avatarRemountKey, openFilePicker, resolveAgentBackground } from './utils';

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

    /* The cover bleeds flush to the pane edges, so rounded corners would leave
       bare notches in the two narrow strips where it meets them. */
    width: calc(100% + 32px);
    height: 160px;
    margin-inline: -16px;

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
  generatedPreview: css`
    position: relative;

    overflow: hidden;

    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorFillQuaternary};
  `,
  studioBadge: css`
    position: absolute;
    z-index: 5;
    inset-block-end: -6px;
    inset-inline-end: -6px;

    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    opacity: 0;
    background: ${cssVar.colorBgElevated};
    box-shadow: ${cssVar.boxShadowTertiary};

    transition: opacity ${cssVar.motionDurationFast};

    .agent-avatar-entry:hover &,
    .agent-avatar-entry:focus-within & {
      opacity: 1;
    }
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
    const [backgroundUploading, setBackgroundUploading] = useState(false);
    const [artworkStyle, setArtworkStyle] = useState<AgentArtworkStyle>(
      DEFAULT_AGENT_ARTWORK_STYLE,
    );
    const generating = generation?.status === 'generating' ? generation.kind : null;
    const generationError = generation?.status === 'error' ? generation.kind : null;
    const backgroundGenerationActive = generation?.kind === 'background';
    const backgroundUrl = resolveAgentBackground(background);

    const openBackgroundFilePicker = useCallback(() => {
      const input = backgroundInputRef.current;
      if (!input) return;

      openFilePicker(input);
    }, []);

    // Avatar uploads moved into the studio; only the cover keeps an inline
    // upload path here.
    const upload = useCallback(
      async (file: File) => {
        if (!canEdit) return;
        if (file.size > MAX_ARTWORK_SIZE) {
          toast.error(t('settingAgent.artwork.sizeExceeded'));
          return;
        }

        setBackgroundUploading(true);
        try {
          const result = await uploadWithProgress({ file });
          if (!result?.url) throw new Error('Upload returned no URL');
          onBackgroundChange(result.url);
        } catch (error) {
          console.error('Failed to upload agent artwork:', error);
          toast.error(t('settingAgent.artwork.uploadFailed'));
        } finally {
          setBackgroundUploading(false);
        }
      },
      [canEdit, onBackgroundChange, t, uploadWithProgress],
    );

    const generateArtwork = useCallback(
      async (kind: 'avatar' | 'background', style: AgentArtworkStyle) => {
        if (!canEdit || !canGenerate) return;

        try {
          await generateAgentArtwork({
            description,
            id: agentId,
            kind,
            name,
            referenceImageUrl: kind === 'background' ? avatar : backgroundUrl,
            style,
            styleReferenceImageUrls: styleReferencesForArtworkStyle(style),
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

    // The generate buttons fire directly with the remembered style; the style
    // menu lives behind a separate "…" trigger beside them. Picking a style
    // there also generates, and the pick is remembered for both artwork kinds
    // so avatar and cover stay one system.
    const buildStyleItems = useCallback(
      (kind: 'avatar' | 'background'): DropdownItem[] =>
        AGENT_ARTWORK_STYLES.map((style) => ({
          icon: style === artworkStyle ? Check : undefined,
          key: style,
          label: t(`settingAgent.artwork.style.${style}`),
          onClick: () => {
            setArtworkStyle(style);
            void generateArtwork(kind, style);
          },
        })),
      [artworkStyle, generateArtwork, t],
    );

    // On the existing-cover hover bar every artwork action folds into the one
    // "…" menu: regenerate, the style presets, and remove.
    const buildBackgroundMenuItems = useCallback((): DropdownItem[] => {
      const items: DropdownItem[] = [];

      if (canGenerate) {
        items.push(
          {
            icon: WandSparkles,
            key: 'generate',
            label: t('settingAgent.artwork.background.generate'),
            onClick: () => void generateArtwork('background', artworkStyle),
          },
          {
            children: buildStyleItems('background'),
            key: 'styles',
            label: t('settingAgent.artwork.styleMenu'),
            type: 'group',
          },
        );
      }

      if (backgroundUrl) {
        if (items.length > 0) items.push({ type: 'divider' });
        items.push({
          danger: true,
          icon: Trash2,
          key: 'remove',
          label: t('settingAgent.artwork.background.remove'),
          onClick: () => onBackgroundChange(null),
        });
      }

      return items;
    }, [
      artworkStyle,
      backgroundUrl,
      buildStyleItems,
      canGenerate,
      generateArtwork,
      onBackgroundChange,
      t,
    ]);

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
                  onClick={() => void generateArtwork('background', artworkStyle)}
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
                    <>
                      <Button
                        icon={WandSparkles}
                        loading={generating === 'background'}
                        size={'small'}
                        onClick={() => void generateArtwork('background', artworkStyle)}
                      >
                        {t('settingAgent.artwork.background.generate')}
                      </Button>
                      <DropdownMenu items={() => buildStyleItems('background')}>
                        <Button
                          aria-label={t('settingAgent.artwork.styleMenu')}
                          icon={MoreHorizontal}
                          size={'small'}
                        />
                      </DropdownMenu>
                    </>
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
              <Tooltip title={t('more', { ns: 'common' })}>
                <DropdownMenu items={() => buildBackgroundMenuItems()}>
                  <ActionIcon glass icon={MoreHorizontal} loading={generating === 'background'} />
                </DropdownMenu>
              </Tooltip>
            </Flexbox>
          ) : null}
        </div>
        <div className={`${styles.avatar} agent-avatar-entry`}>
          {/* Uploading an image lives in the studio, so the picker keeps only
              emoji plus the studio launcher tab; the launcher tab is ordered
              first and auto-selected on open, preserving the old generate-tab
              position. */}
          {/* Keyed by the url for the same reason as the studio preview: the
              underlying Avatar latches its image-error state, so without a
              remount a newly generated avatar stays invisible whenever the
              previous one failed to load. */}
          <EmojiPicker
            allowModelAvatar
            allowDelete={canEdit && !!avatar}
            key={avatarRemountKey(avatar)}
            locale={locale}
            open={canEdit ? undefined : false}
            popupClassName={`${styles.avatarPicker} agent-avatar-artwork-picker`}
            popupProps={{ placement: 'bottomLeft' }}
            shape={'square'}
            size={72}
            value={avatar || undefined}
            customTabs={[
              {
                label: (
                  <Tooltip title={t('settingAgent.artwork.avatar.image')}>
                    <Icon icon={ImageIcon} size={{ size: 20, strokeWidth: 2.5 }} />
                  </Tooltip>
                ),
                render: () => (
                  <Flexbox gap={16} padding={20} width={348}>
                    <Center className={styles.generatedPreview} height={156}>
                      <Avatar
                        avatar={avatar || undefined}
                        key={avatarRemountKey(avatar)}
                        shape={'square'}
                        size={112}
                      />
                    </Center>
                    <Button
                      icon={WandSparkles}
                      type={'primary'}
                      onClick={() => openAgentArtworkStudio(agentId)}
                    >
                      {t('settingAgent.artwork.studio.openAction')}
                    </Button>
                  </Flexbox>
                ),
                value: 'generate',
              },
            ]}
            onChange={(value) => onAvatarChange(value)}
            onDelete={() => onAvatarChange(null)}
            onOpenChange={(open) => {
              if (!open) return;

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
          {/* Hover-revealed corner badge as the direct studio entry. */}
          {canEdit ? (
            <Tooltip title={t('settingAgent.artwork.studio.open')}>
              <ActionIcon
                className={styles.studioBadge}
                icon={WandSparkles}
                size={'small'}
                onClick={() => openAgentArtworkStudio(agentId)}
              />
            </Tooltip>
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
            if (file) void upload(file);
          }}
        />
      </div>
    );
  },
);

AgentProfileArtwork.displayName = 'AgentProfileArtwork';

export { resolveAgentBackground } from './utils';
