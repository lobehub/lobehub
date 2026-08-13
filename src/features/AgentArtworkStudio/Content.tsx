'use client';

import { imageUrl } from '@lobechat/const';
import {
  AGENT_ARTWORK_STYLES,
  type AgentArtworkStyle,
  DEFAULT_AGENT_ARTWORK_STYLE,
} from '@lobechat/prompts';
import { Alert, Avatar, Center, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { Button, toast, useModalContext } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Check, SettingsIcon, UploadIcon, WandSparkles } from 'lucide-react';
import { memo, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import {
  avatarRemountKey,
  openFilePicker,
  resolveAgentBackground,
} from '@/features/AgentProfileArtwork/utils';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useAgentStore } from '@/store/agent';
import { agentArtworkSelectors, agentSelectors } from '@/store/agent/selectors';
import { useAiInfraStore } from '@/store/aiInfra';
import { aiProviderSelectors } from '@/store/aiInfra/selectors';
import { useFileStore } from '@/store/file';

import {
  LOBE_STYLE_REFERENCE_IMAGE_URLS,
  styleReferencesForArtworkStyle,
} from './lobeStyleReferences';

const MAX_AVATAR_SIZE = 1024 * 1024;

const GALLERY_STYLES = AGENT_ARTWORK_STYLES.filter((item) => item !== 'lobe');

const styles = createStaticStyles(({ css }) => ({
  galleryCheck: css`
    position: absolute;
    z-index: 1;
    inset-block-start: 6px;
    inset-inline-end: 6px;

    width: 20px;
    height: 20px;
    border-radius: 50%;

    color: ${cssVar.colorTextLightSolid};

    background: ${cssVar.colorPrimary};
  `,
  galleryGrid: css`
    display: grid;

    /* One row of five, per review: the set is curated to exactly five styles. */
    grid-template-columns: repeat(5, 1fr);
    gap: 8px;
  `,
  galleryItem: css`
    cursor: pointer;
    border-radius: ${cssVar.borderRadiusLG};

    &:hover img {
      filter: brightness(1.06);
    }
  `,
  galleryLabel: css`
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    text-align: center;
  `,
  galleryThumb: css`
    aspect-ratio: 1;
    width: 100%;
    border-radius: ${cssVar.borderRadiusLG};

    object-fit: cover;

    transition: filter ${cssVar.motionDurationFast};
  `,
  galleryThumbWrap: css`
    position: relative;
  `,
  generationOverlay: css`
    position: absolute;
    z-index: 2;
    inset: 0;

    border-radius: calc(${cssVar.borderRadiusLG} - 1px);

    background: color-mix(in srgb, ${cssVar.colorBgContainer} 88%, transparent);
    backdrop-filter: blur(12px);
  `,
  hint: css`
    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
  `,
  lobeCard: css`
    cursor: pointer;
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillQuaternary};
    transition: background ${cssVar.motionDurationFast};

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  lobeCardActive: css`
    background: ${cssVar.colorFillSecondary};

    &:hover {
      background: ${cssVar.colorFillSecondary};
    }
  `,
  noModelBlock: css`
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillQuaternary};
  `,
  preview: css`
    position: relative;

    overflow: hidden;
    flex: none;

    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorFillQuaternary};
  `,
  sectionTitle: css`
    font-weight: 500;
  `,
  visuallyHiddenInput: css`
    pointer-events: none;

    position: fixed;

    overflow: hidden;

    width: 1px;
    height: 1px;

    opacity: 0;
  `,
}));

interface AgentArtworkStudioContentProps {
  agentId: string;
}

const AgentArtworkStudioContent = memo<AgentArtworkStudioContentProps>(({ agentId }) => {
  const { t } = useTranslation('setting');
  const { close } = useModalContext();
  const navigate = useWorkspaceAwareNavigate();
  const meta = useAgentStore(agentSelectors.getAgentMetaById(agentId));
  const systemRole = useAgentStore(
    (s) => agentSelectors.getAgentConfigById(agentId)(s)?.systemRole,
  );
  const generation = useAgentStore(agentArtworkSelectors.generationByAgentId(agentId));
  const generateAgentArtwork = useAgentStore((s) => s.generateAgentArtwork);
  const cancelAgentArtworkGeneration = useAgentStore((s) => s.cancelAgentArtworkGeneration);
  const updateAgentMetaById = useAgentStore((s) => s.updateAgentMetaById);
  const uploadWithProgress = useFileStore((s) => s.uploadWithProgress);
  const canGenerate = useAiInfraStore(
    (state) => aiProviderSelectors.enabledImageModelList(state).length > 0,
  );

  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [style, setStyle] = useState<AgentArtworkStyle>(DEFAULT_AGENT_ARTWORK_STYLE);

  const generating = generation?.status === 'generating' && generation.kind === 'avatar';
  const generationError = generation?.status === 'error' && generation.kind === 'avatar';

  const generate = useCallback(
    (nextStyle: AgentArtworkStyle) => {
      generateAgentArtwork({
        description: meta.description,
        id: agentId,
        kind: 'avatar',
        name: meta.name,
        referenceImageUrl: resolveAgentBackground(meta.backgroundColor),
        style: nextStyle,
        styleReferenceImageUrls: styleReferencesForArtworkStyle(nextStyle),
        systemRole,
        title: meta.title,
      }).catch(() => {
        // The Agent store owns the persistent error state rendered below.
      });
    },
    [
      agentId,
      generateAgentArtwork,
      meta.backgroundColor,
      meta.description,
      meta.name,
      meta.title,
      systemRole,
    ],
  );

  const upload = useCallback(
    async (file: File) => {
      if (file.size > MAX_AVATAR_SIZE) {
        toast.error(t('settingAgent.artwork.sizeExceeded'));
        return;
      }

      setUploading(true);
      try {
        const result = await uploadWithProgress({ file });
        if (!result?.url) throw new Error('Upload returned no URL');
        await updateAgentMetaById(agentId, { avatar: result.url });
      } catch (error) {
        console.error('Failed to upload agent avatar:', error);
        toast.error(t('settingAgent.artwork.uploadFailed'));
      } finally {
        setUploading(false);
      }
    },
    [agentId, t, updateAgentMetaById, uploadWithProgress],
  );

  const selectStyle = useCallback((next: AgentArtworkStyle) => setStyle(next), []);

  const keySelect = useCallback(
    (next: AgentArtworkStyle) => (event: { key: string; preventDefault: () => void }) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        setStyle(next);
      }
    },
    [],
  );

  return (
    <Flexbox horizontal gap={32} padding={24} wrap={'wrap'}>
      {/* DIY path: the live avatar plus upload. The preview doubles as the
          generation stage so both paths land on the same picture. */}
      <Flexbox gap={16} style={{ flex: 'none', width: 232 }}>
        <Center className={styles.preview} height={232} width={232}>
          {/* Keyed by the url: Avatar latches an internal `isImgError` on the
              first failed load and never clears it when `avatar` changes, so a
              previously broken avatar would keep the freshly generated one
              invisible until a reload. */}
          <Avatar
            avatar={meta.avatar || undefined}
            key={avatarRemountKey(meta.avatar)}
            shape={'square'}
            size={180}
          />
          {generating ? (
            <Center className={styles.generationOverlay}>
              <Flexbox align={'center'} gap={10}>
                <NeuralNetworkLoading size={32} />
                <Flexbox align={'center'} gap={4}>
                  <Text className={styles.sectionTitle}>
                    {t('settingAgent.artwork.avatar.generating')}
                  </Text>
                  <Text className={styles.hint} style={{ textAlign: 'center' }}>
                    {t('settingAgent.artwork.generatingHint')}
                  </Text>
                  <Button
                    size={'small'}
                    style={{ marginBlockStart: 4 }}
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
        <Flexbox gap={8}>
          <Text className={styles.sectionTitle}>{t('settingAgent.artwork.studio.diyTitle')}</Text>
          <Text className={styles.hint}>{t('settingAgent.artwork.studio.diyHint')}</Text>
          <Button
            icon={UploadIcon}
            loading={uploading}
            onClick={() => {
              const input = uploadInputRef.current;
              if (input) openFilePicker(input);
            }}
          >
            {t('settingAgent.artwork.studio.upload')}
          </Button>
        </Flexbox>
      </Flexbox>

      {/* One-click path: brand style first, then the generated style gallery. */}
      <Flexbox gap={16} style={{ flex: 1, minWidth: 280 }}>
        <Flexbox gap={4}>
          <Text className={styles.sectionTitle}>
            {t('settingAgent.artwork.studio.generateTitle')}
          </Text>
          <Text className={styles.hint}>{t('settingAgent.artwork.studio.generateHint')}</Text>
        </Flexbox>

        {canGenerate ? (
          <>
            <Flexbox
              horizontal
              align={'center'}
              className={`${styles.lobeCard} ${style === 'lobe' ? styles.lobeCardActive : ''}`}
              gap={12}
              padding={12}
              role={'button'}
              tabIndex={0}
              onClick={() => selectStyle('lobe')}
              onKeyDown={keySelect('lobe')}
            >
              <Flexbox horizontal flex={'none'} gap={4}>
                {LOBE_STYLE_REFERENCE_IMAGE_URLS.map((url) => (
                  <Avatar avatar={url} key={url} shape={'square'} size={40} />
                ))}
              </Flexbox>
              <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
                <Flexbox horizontal align={'center'} gap={8}>
                  <Text className={styles.sectionTitle}>
                    {t('settingAgent.artwork.studio.lobeStyle')}
                  </Text>
                  <Tag color={'processing'} size={'small'}>
                    {t('settingAgent.artwork.studio.recommended')}
                  </Tag>
                </Flexbox>
                <Text ellipsis className={styles.hint}>
                  {t('settingAgent.artwork.style.lobe')}
                </Text>
              </Flexbox>
              {style === 'lobe' ? (
                <Icon color={cssVar.colorPrimary} icon={Check} size={18} style={{ flex: 'none' }} />
              ) : null}
            </Flexbox>

            <Flexbox gap={8}>
              <Text className={styles.hint}>{t('settingAgent.artwork.studio.moreStyles')}</Text>
              <div className={styles.galleryGrid}>
                {GALLERY_STYLES.map((item) => (
                  <Flexbox
                    className={styles.galleryItem}
                    gap={6}
                    key={item}
                    role={'button'}
                    tabIndex={0}
                    onClick={() => selectStyle(item)}
                    onKeyDown={keySelect(item)}
                  >
                    <div className={styles.galleryThumbWrap}>
                      <img
                        alt={t(`settingAgent.artwork.style.${item}`)}
                        className={styles.galleryThumb}
                        src={imageUrl(`agent-artwork-styles/style-${item}.jpg`)}
                      />
                      {style === item ? (
                        <Center className={styles.galleryCheck}>
                          <Icon icon={Check} size={13} />
                        </Center>
                      ) : null}
                    </div>
                    <Text ellipsis className={styles.galleryLabel}>
                      {t(`settingAgent.artwork.style.${item}`)}
                    </Text>
                  </Flexbox>
                ))}
              </div>
            </Flexbox>

            <Flexbox gap={8} style={{ marginBlockStart: 'auto' }}>
              <Button
                disabled={generating}
                icon={WandSparkles}
                type={'primary'}
                onClick={() => generate(style)}
              >
                {t('settingAgent.artwork.studio.generate')}
              </Button>
              {generationError ? (
                <Alert showIcon title={t('settingAgent.artwork.generateFailed')} type={'error'} />
              ) : null}
            </Flexbox>
          </>
        ) : (
          <Center className={styles.noModelBlock} flex={1} gap={12} padding={24}>
            <Text className={styles.hint} style={{ textAlign: 'center' }}>
              {t('settingAgent.artwork.studio.noModel')}
            </Text>
            <Button
              icon={SettingsIcon}
              type={'primary'}
              onClick={() => {
                close();
                navigate('/settings/provider/all');
              }}
            >
              {t('settingAgent.artwork.studio.enableModel')}
            </Button>
          </Center>
        )}
      </Flexbox>

      <input
        accept="image/*"
        aria-label={t('settingAgent.artwork.studio.upload')}
        className={styles.visuallyHiddenInput}
        ref={uploadInputRef}
        tabIndex={-1}
        type="file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void upload(file);
        }}
      />
    </Flexbox>
  );
});

AgentArtworkStudioContent.displayName = 'AgentArtworkStudioContent';

export default AgentArtworkStudioContent;
