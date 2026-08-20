'use client';

import { imageUrl } from '@lobechat/const';
import type { AgentArtworkComposition, AgentArtworkStyle } from '@lobechat/prompts';
import { AGENT_ARTWORK_STYLES } from '@lobechat/prompts';
import {
  Accordion,
  AccordionItem,
  ActionIcon,
  Avatar,
  Center,
  Flexbox,
  Icon,
  Input,
  Text,
} from '@lobehub/ui';
import { Alert, Button, useModalContext } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  Check,
  CircleUserRound,
  PersonStanding,
  SettingsIcon,
  Trash2,
  UploadIcon,
  WandSparkles,
} from 'lucide-react';
import { memo, type MouseEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { avatarRemountKey, openFilePicker } from '@/features/AgentProfileArtwork/utils';
import { CHIEF_AGENT_ARTWORKS, DEFAULT_CHIEF_AGENT_ARTWORK } from '@/features/ChiefAgent/artwork';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useAiInfraStore } from '@/store/aiInfra';
import { aiProviderSelectors } from '@/store/aiInfra/selectors';

const GALLERY_STYLES = AGENT_ARTWORK_STYLES;
const LOBE_STYLE_PREVIEW =
  CHIEF_AGENT_ARTWORKS.find((item) => item.id === 'sienna')?.avatar ??
  DEFAULT_CHIEF_AGENT_ARTWORK.avatar;

/**
 * The avatar fills its own grid column and the full-body slot stretches to the
 * same row height, so the pair sizes with the modal instead of a fixed number.
 * This is the breathing room left around the avatar inside its frame.
 */
const AVATAR_INSET = 40;
/** Default slot size; the pair shrinks below it on a narrower modal. */
const PREVIEW_MAX_SIZE = 240;
/**
 * The style gallery is a picker, not content. At full-bleed thumbnail size its
 * five saturated images outweighed the artwork the modal is actually about, so
 * it is sized as a control strip.
 */
const STYLE_THUMB_SIZE = 64;
const GENERATE_SECTION_KEY = 'generate';

const styles = createStaticStyles(({ css }) => ({
  galleryCheck: css`
    position: absolute;
    z-index: 1;
    inset-block-start: 4px;
    inset-inline-end: 4px;

    width: 16px;
    height: 16px;
    border-radius: 50%;

    color: ${cssVar.colorTextLightSolid};

    background: ${cssVar.colorPrimary};
  `,
  galleryGrid: css`
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: start;
  `,
  galleryItem: css`
    cursor: pointer;

    width: ${STYLE_THUMB_SIZE + 8}px;
    padding: 4px;
    border: 1px solid transparent;
    border-radius: ${cssVar.borderRadiusLG};

    transition:
      border-color ${cssVar.motionDurationFast},
      background ${cssVar.motionDurationFast};

    &:hover img {
      filter: brightness(1.06);
    }
  `,
  galleryItemActive: css`
    border-color: ${cssVar.colorPrimary};
    background: ${cssVar.colorFillTertiary};
  `,
  galleryLabel: css`
    font-size: 12px;
    line-height: 16px;
    color: ${cssVar.colorTextSecondary};
    text-align: center;
  `,
  galleryThumb: css`
    aspect-ratio: 1;
    width: ${STYLE_THUMB_SIZE}px;
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

    padding: 12px;
    border-radius: calc(${cssVar.borderRadiusLG} - 1px);

    background: color-mix(in srgb, ${cssVar.colorBgContainer} 88%, transparent);
    backdrop-filter: blur(12px);
  `,
  generationOverlayTitle: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;

    font-size: 13px;
    font-weight: 500;
    line-height: 18px;
    text-align: center;
  `,
  hint: css`
    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
  `,
  noModelBlock: css`
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillQuaternary};
  `,
  outputCard: css`
    cursor: pointer;
    padding-block: 0;
    padding-inline: 8px;
  `,
  /**
   * Upload / generate / remove live on the artwork and only appear on hover or
   * keyboard focus, so a settled slot is just the character.
   */
  outputActions: css`
    position: absolute;
    z-index: 2;
    inset-block-end: 10px;
    inset-inline: 10px;

    opacity: 0;

    transition: opacity ${cssVar.motionDurationMid};
  `,
  outputColumn: css`
    width: 100%;
    height: 100%;
  `,
  outputGrid: css`
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 24px;
    align-items: stretch;
  `,
  outputPreview: css`
    position: relative;

    overflow: hidden;

    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};

    &:hover [data-slot-actions],
    &:focus-within [data-slot-actions] {
      opacity: 1;
    }
  `,
  /**
   * Square, and as wide as the column allows up to its default size — this sets
   * the row height, and shrinks with the modal rather than pinning a number.
   */
  outputPreviewAvatar: css`
    aspect-ratio: 1;
    width: 100%;
    max-width: ${PREVIEW_MAX_SIZE}px;
  `,
  /** Matches the avatar's height; its own ratio then decides the width. */
  /**
   * Matches the avatar's height — same cap, so the pair stays level — and its
   * own ratio then decides the width.
   */
  outputPreviewFullBody: css`
    aspect-ratio: 3 / 4;
    max-width: 100%;
    height: 100%;
    max-height: ${PREVIEW_MAX_SIZE}px;
  `,
  previewBodyImage: css`
    width: 100%;
    height: 100%;
    object-fit: contain;
  `,
  controlLabel: css`
    font-size: 12px;
    line-height: 16px;
    color: ${cssVar.colorTextTertiary};
  `,
  removeButton: css`
    position: absolute;
    z-index: 2;
    inset-block-start: 8px;
    inset-inline-end: 8px;

    opacity: 0;
    background: color-mix(in srgb, ${cssVar.colorBgContainer} 72%, transparent);
    backdrop-filter: blur(8px);

    transition: opacity ${cssVar.motionDurationMid};
  `,
  sectionTitle: css`
    font-weight: 500;
  `,
  uploadSpec: css`
    font-size: 12px;
    line-height: 16px;
    color: ${cssVar.colorTextQuaternary};
    text-align: center;
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
  /** Current or freshly generated full-body artwork. */
  fullBody?: string | null;
  generating?: boolean;
  generatingTarget?: AgentArtworkComposition | 'both';
  /** Headline shown over the preview while a generation runs. */
  generatingTitle: string;
  /** True when the last generation attempt failed and can be retried. */
  generationFailed?: boolean;
  /**
   * True when the subject has an avatar of its own. Separate from `avatar`,
   * which falls back to a default so the slot is never blank — there is
   * nothing to remove when only the fallback is showing.
   */
  hasStoredAvatar?: boolean;
  /** Free-text direction the subject was last generated with. */
  initialDirection?: string;
  /** Style preset the subject was last generated with. */
  initialStyle?: string;
  onCancel: () => void;
  onGenerate: (
    style: AgentArtworkStyle,
    composition?: AgentArtworkComposition,
    direction?: string,
  ) => void;
  /** Clears the artwork in one slot. */
  onRemove: (composition: AgentArtworkComposition) => void;
  onUpload: (file: File, composition: AgentArtworkComposition) => void;
  uploading?: boolean;
}

/**
 * Artwork workshop shared by every subject that can own one (Agents, workspaces).
 * The same underlying image is shown in its two product crops so users can
 * choose the intended generation composition without hiding either result.
 */
/**
 * The avatar sizes itself off the slot rather than a fixed pixel value, so the
 * pair keeps its proportions as the modal grows.
 */
const AvatarSlotImage = memo<{ avatar?: string | null }>(({ avatar }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const observer = new ResizeObserver(([entry]) => {
      setSize(Math.max(0, Math.round(entry.contentRect.width) - AVATAR_INSET));
    });
    observer.observe(node);

    return () => observer.disconnect();
  }, []);

  return (
    <Center height={'100%'} ref={ref} width={'100%'}>
      {size > 0 ? (
        <Avatar
          avatar={avatar || undefined}
          key={avatarRemountKey(avatar)}
          shape={'square'}
          size={size}
        />
      ) : null}
    </Center>
  );
});

AvatarSlotImage.displayName = 'AvatarSlotImage';

const ArtworkStudioContent = memo<ArtworkStudioContentProps>(
  ({
    avatar,
    fullBody,
    generatingTitle,
    generating,
    generatingTarget,
    generationFailed,
    hasStoredAvatar,
    initialDirection,
    initialStyle,
    onCancel,
    onGenerate,
    onRemove,
    onUpload,
    uploading,
  }) => {
    const { t } = useTranslation('setting');
    const { close } = useModalContext();
    const navigate = useWorkspaceAwareNavigate();
    const canGenerate = useAiInfraStore(
      (state) => aiProviderSelectors.enabledImageModelList(state).length > 0,
    );

    const avatarInputRef = useRef<HTMLInputElement>(null);
    const fullBodyInputRef = useRef<HTMLInputElement>(null);
    // Resume the subject's own last choice; a preset that no longer exists
    // falls back rather than leaving the gallery with nothing selected.
    const [style, setStyle] = useState<AgentArtworkStyle>(() =>
      GALLERY_STYLES.includes(initialStyle as AgentArtworkStyle)
        ? (initialStyle as AgentArtworkStyle)
        : 'anime',
    );
    const [direction, setDirection] = useState(initialDirection ?? '');
    const [generateExpanded, setGenerateExpanded] = useState(true);
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

    const isGenerating = (composition: AgentArtworkComposition) =>
      !!generating && (generatingTarget === composition || generatingTarget === 'both');

    // The slot is only ~200px wide, so the overlay carries the headline and the
    // cancel affordance; the duration hint sits under the row where it has space.
    // Sits on the preview rather than in the button row: removal is rare next to
    // upload and generate, and a third button crowded the ~200px column.
    const renderRemove = (composition: AgentArtworkComposition, hasImage: boolean) =>
      hasImage && !isGenerating(composition) ? (
        <ActionIcon
          data-slot-actions
          className={styles.removeButton}
          icon={Trash2}
          size={'small'}
          title={t('artworkStudio.remove')}
          onClick={(event: MouseEvent<HTMLDivElement>) => {
            event.stopPropagation();
            onRemove(composition);
          }}
        />
      ) : null;

    const renderGenerationOverlay = (composition: AgentArtworkComposition) =>
      isGenerating(composition) ? (
        <Center className={styles.generationOverlay} gap={8}>
          <NeuralNetworkLoading size={28} />
          <Text className={styles.generationOverlayTitle}>{generatingTitle}</Text>
          <Button size={'small'} type={'fill'} onClick={onCancel}>
            {t('artworkStudio.cancel')}
          </Button>
        </Center>
      ) : null;

    return (
      <Flexbox gap={24} padding={24}>
        <div className={styles.outputGrid}>
          <Flexbox
            align={'center'}
            className={styles.outputCard}
            gap={10}
            role={'button'}
            tabIndex={0}
            onClick={() => avatarInputRef.current && openFilePicker(avatarInputRef.current)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                if (avatarInputRef.current) openFilePicker(avatarInputRef.current);
              }
            }}
          >
            <Flexbox horizontal align={'center'} gap={6}>
              <Icon icon={CircleUserRound} size={16} />
              <Text className={styles.sectionTitle}>{t('artworkStudio.composition.avatar')}</Text>
            </Flexbox>
            <Flexbox align={'center'} className={styles.outputColumn} gap={10}>
              <Center className={`${styles.outputPreview} ${styles.outputPreviewAvatar}`}>
                <AvatarSlotImage avatar={avatar} />
                {renderRemove('avatar', !!hasStoredAvatar)}
                <Flexbox data-slot-actions horizontal className={styles.outputActions} gap={8}>
                  <Button icon={UploadIcon} loading={uploading} style={{ flex: 1 }} type={'fill'}>
                    {t('artworkStudio.upload')}
                  </Button>
                  <Button
                    icon={WandSparkles}
                    style={{ flex: 1 }}
                    type={'fill'}
                    onClick={(event) => {
                      event.stopPropagation();
                      onGenerate(style, 'avatar', direction);
                    }}
                  >
                    {t('artworkStudio.generate.avatar')}
                  </Button>
                </Flexbox>
                {renderGenerationOverlay('avatar')}
              </Center>
              <Text className={styles.uploadSpec}>{t('artworkStudio.uploadSpec.avatar')}</Text>
            </Flexbox>
          </Flexbox>
          <Flexbox
            align={'center'}
            className={styles.outputCard}
            gap={10}
            role={'button'}
            tabIndex={0}
            onClick={() => fullBodyInputRef.current && openFilePicker(fullBodyInputRef.current)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                if (fullBodyInputRef.current) openFilePicker(fullBodyInputRef.current);
              }
            }}
          >
            <Flexbox horizontal align={'center'} gap={6}>
              <Icon icon={PersonStanding} size={16} />
              <Text className={styles.sectionTitle}>{t('artworkStudio.composition.fullBody')}</Text>
            </Flexbox>
            <Flexbox align={'center'} className={styles.outputColumn} gap={10}>
              <Center className={`${styles.outputPreview} ${styles.outputPreviewFullBody}`}>
                {fullBody ? (
                  <img
                    alt={t('artworkStudio.preview.fullBody')}
                    className={styles.previewBodyImage}
                    src={fullBody}
                  />
                ) : (
                  <Icon icon={PersonStanding} size={64} />
                )}
                {renderRemove('fullBody', !!fullBody)}
                <Flexbox data-slot-actions horizontal className={styles.outputActions} gap={8}>
                  <Button icon={UploadIcon} loading={uploading} style={{ flex: 1 }} type={'fill'}>
                    {t('artworkStudio.upload')}
                  </Button>
                  <Button
                    icon={WandSparkles}
                    style={{ flex: 1 }}
                    type={'fill'}
                    onClick={(event) => {
                      event.stopPropagation();
                      onGenerate(style, 'fullBody', direction);
                    }}
                  >
                    {t('artworkStudio.generate.fullBody')}
                  </Button>
                </Flexbox>
                {renderGenerationOverlay('fullBody')}
              </Center>
              <Text className={styles.uploadSpec}>{t('artworkStudio.uploadSpec.fullBody')}</Text>
            </Flexbox>
          </Flexbox>
        </div>

        {generating ? (
          <Text className={styles.hint} style={{ textAlign: 'center' }}>
            {t('artworkStudio.generatingHint')}
          </Text>
        ) : null}

        {canGenerate ? (
          <>
            <Accordion
              expandedKeys={generateExpanded ? [GENERATE_SECTION_KEY] : []}
              gap={4}
              onExpandedChange={(keys) => setGenerateExpanded(keys.length > 0)}
            >
              <AccordionItem
                itemKey={GENERATE_SECTION_KEY}
                paddingBlock={2}
                paddingInline={0}
                title={
                  <Text className={styles.controlLabel}>{t('artworkStudio.generateTitle')}</Text>
                }
              >
                <Flexbox gap={12} paddingBlock={'4px 0'}>
                  <div className={styles.galleryGrid}>
                    {GALLERY_STYLES.map((item) => (
                      <Flexbox
                        className={`${styles.galleryItem} ${style === item ? styles.galleryItemActive : ''}`}
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
                            src={
                              item === 'lobe'
                                ? LOBE_STYLE_PREVIEW
                                : imageUrl(`agent-artwork-styles/style-${item}.webp`)
                            }
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
                  <Input
                    disabled={generating}
                    placeholder={t('artworkStudio.direction.placeholder')}
                    value={direction}
                    onChange={(event) => setDirection(event.target.value)}
                  />
                  <Flexbox horizontal>
                    <Button
                      disabled={generating}
                      icon={WandSparkles}
                      type={'fill'}
                      onClick={() => onGenerate(style, undefined, direction)}
                    >
                      {t('artworkStudio.generate.characterSet')}
                    </Button>
                  </Flexbox>
                  {generationFailed ? (
                    <Alert showIcon title={t('artworkStudio.generateFailed')} type={'error'} />
                  ) : null}
                </Flexbox>
              </AccordionItem>
            </Accordion>
          </>
        ) : (
          <Center className={styles.noModelBlock} flex={1} gap={12} padding={24}>
            <Text className={styles.hint} style={{ textAlign: 'center' }}>
              {t('artworkStudio.noModel')}
            </Text>
            <Button
              icon={SettingsIcon}
              type={'fill'}
              onClick={() => {
                close();
                navigate('/settings/provider/all');
              }}
            >
              {t('artworkStudio.enableModel')}
            </Button>
          </Center>
        )}

        <input
          accept="image/*"
          aria-label={t('artworkStudio.upload')}
          className={styles.visuallyHiddenInput}
          ref={avatarInputRef}
          tabIndex={-1}
          type="file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) onUpload(file, 'avatar');
          }}
        />
        <input
          accept="image/*"
          aria-label={t('artworkStudio.upload')}
          className={styles.visuallyHiddenInput}
          ref={fullBodyInputRef}
          tabIndex={-1}
          type="file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) onUpload(file, 'fullBody');
          }}
        />
      </Flexbox>
    );
  },
);

ArtworkStudioContent.displayName = 'ArtworkStudioContent';

export default ArtworkStudioContent;
