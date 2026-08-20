'use client';

import { imageUrl } from '@lobechat/const';
import {
  AGENT_ARTWORK_STYLES,
  type AgentArtworkStyle,
  DEFAULT_AGENT_ARTWORK_STYLE,
} from '@lobechat/prompts';
import { Avatar, Center, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { Alert, Button, useModalContext } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Check, SettingsIcon, UploadIcon, WandSparkles } from 'lucide-react';
import { memo, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { avatarRemountKey, openFilePicker } from '@/features/AgentProfileArtwork/utils';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useAiInfraStore } from '@/store/aiInfra';
import { aiProviderSelectors } from '@/store/aiInfra/selectors';

import { LOBE_STYLE_REFERENCE_IMAGE_URLS } from './styleReferences';

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

export interface ArtworkStudioContentProps {
  /** Current avatar url; falsy renders the empty avatar placeholder. */
  avatar?: string | null;
  /** Copy under the "make your own" heading — names the subject being dressed. */
  diyHint: string;
  /** Copy under the "generate with AI" heading. */
  generateHint: string;
  generating?: boolean;
  /** Headline shown over the preview while a generation runs. */
  generatingTitle: string;
  /** True when the last generation attempt failed and can be retried. */
  generationFailed?: boolean;
  onCancel: () => void;
  onGenerate: (style: AgentArtworkStyle) => void;
  onUpload: (file: File) => void;
  uploading?: boolean;
}

/**
 * Avatar workshop shared by every subject that can own one (Agents, workspaces):
 * make your own on the left, one-click generation in a preset style on the
 * right. Purely presentational — the caller owns the avatar value, the
 * generation lifecycle, and where the result is persisted.
 */
const ArtworkStudioContent = memo<ArtworkStudioContentProps>(
  ({
    avatar,
    diyHint,
    generateHint,
    generatingTitle,
    generating,
    generationFailed,
    onCancel,
    onGenerate,
    onUpload,
    uploading,
  }) => {
    const { t } = useTranslation('setting');
    const { close } = useModalContext();
    const navigate = useWorkspaceAwareNavigate();
    const canGenerate = useAiInfraStore(
      (state) => aiProviderSelectors.enabledImageModelList(state).length > 0,
    );

    const uploadInputRef = useRef<HTMLInputElement>(null);
    const [style, setStyle] = useState<AgentArtworkStyle>(DEFAULT_AGENT_ARTWORK_STYLE);

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
              avatar={avatar || undefined}
              key={avatarRemountKey(avatar)}
              shape={'square'}
              size={180}
            />
            {generating ? (
              <Center className={styles.generationOverlay}>
                <Flexbox align={'center'} gap={10}>
                  <NeuralNetworkLoading size={32} />
                  <Flexbox align={'center'} gap={4}>
                    <Text className={styles.sectionTitle}>{generatingTitle}</Text>
                    <Text className={styles.hint} style={{ textAlign: 'center' }}>
                      {t('artworkStudio.generatingHint')}
                    </Text>
                    <Button
                      size={'small'}
                      style={{ marginBlockStart: 4 }}
                      type={'fill'}
                      onClick={onCancel}
                    >
                      {t('artworkStudio.cancel')}
                    </Button>
                  </Flexbox>
                </Flexbox>
              </Center>
            ) : null}
          </Center>
          <Flexbox gap={8}>
            <Text className={styles.sectionTitle}>{t('artworkStudio.diyTitle')}</Text>
            <Text className={styles.hint}>{diyHint}</Text>
            <Button
              icon={UploadIcon}
              loading={uploading}
              onClick={() => {
                const input = uploadInputRef.current;
                if (input) openFilePicker(input);
              }}
            >
              {t('artworkStudio.upload')}
            </Button>
          </Flexbox>
        </Flexbox>

        {/* One-click path: brand style first, then the generated style gallery. */}
        <Flexbox gap={16} style={{ flex: 1, minWidth: 280 }}>
          <Flexbox gap={4}>
            <Text className={styles.sectionTitle}>{t('artworkStudio.generateTitle')}</Text>
            <Text className={styles.hint}>{generateHint}</Text>
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
                    <Text className={styles.sectionTitle}>{t('artworkStudio.lobeStyle')}</Text>
                    <Tag color={'processing'} size={'small'}>
                      {t('artworkStudio.recommended')}
                    </Tag>
                  </Flexbox>
                  <Text ellipsis className={styles.hint}>
                    {t('artworkStudio.style.lobe')}
                  </Text>
                </Flexbox>
                {style === 'lobe' ? (
                  <Icon
                    color={cssVar.colorPrimary}
                    icon={Check}
                    size={18}
                    style={{ flex: 'none' }}
                  />
                ) : null}
              </Flexbox>

              <Flexbox gap={8}>
                <Text className={styles.hint}>{t('artworkStudio.moreStyles')}</Text>
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
                          alt={t(`artworkStudio.style.${item}`)}
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
                        {t(`artworkStudio.style.${item}`)}
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
                  onClick={() => onGenerate(style)}
                >
                  {t('artworkStudio.generate')}
                </Button>
                {generationFailed ? (
                  <Alert showIcon title={t('artworkStudio.generateFailed')} type={'error'} />
                ) : null}
              </Flexbox>
            </>
          ) : (
            <Center className={styles.noModelBlock} flex={1} gap={12} padding={24}>
              <Text className={styles.hint} style={{ textAlign: 'center' }}>
                {t('artworkStudio.noModel')}
              </Text>
              <Button
                icon={SettingsIcon}
                type={'primary'}
                onClick={() => {
                  close();
                  navigate('/settings/provider/all');
                }}
              >
                {t('artworkStudio.enableModel')}
              </Button>
            </Center>
          )}
        </Flexbox>

        <input
          accept="image/*"
          aria-label={t('artworkStudio.upload')}
          className={styles.visuallyHiddenInput}
          ref={uploadInputRef}
          tabIndex={-1}
          type="file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) onUpload(file);
          }}
        />
      </Flexbox>
    );
  },
);

ArtworkStudioContent.displayName = 'ArtworkStudioContent';

export default ArtworkStudioContent;
