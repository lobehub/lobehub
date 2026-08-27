'use client';

import { imageUrl } from '@lobechat/const';
import type { AgentArtworkComposition, AgentArtworkStyle } from '@lobechat/prompts';
import { AGENT_ARTWORK_STYLES } from '@lobechat/prompts';
import { Accordion, AccordionItem, Center, Flexbox, Icon, Input } from '@lobehub/ui';
import { ActionIcon, Alert, Avatar, Button, Text, useModalContext } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  CircleUserRound,
  Frame,
  ImagePlus,
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
import { HOME_PORTRAIT_VISIBLE_RATIO } from '@/features/Home/portraitFraming';
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
/**
 * Vertical breathing room inside the full-body slot. The avatar gets a much
 * larger inset because a head reads fine small; a full body needs the height,
 * so this only keeps the character off the frame's edge.
 */
const FULL_BODY_INSET = 12;

const styles = createStaticStyles(({ css }) => ({
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
  /** Empty state of the custom-reference tile: same footprint as a thumbnail. */
  referenceEmpty: css`
    aspect-ratio: 1;
    width: ${STYLE_THUMB_SIZE}px;
    border: 1px dashed ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadiusLG};

    color: ${cssVar.colorTextTertiary};
  `,
  referenceRemove: css`
    position: absolute;
    z-index: 1;
    inset-block-start: 2px;
    inset-inline-end: 2px;

    opacity: 0;
    background: color-mix(in srgb, ${cssVar.colorBgContainer} 72%, transparent);
    backdrop-filter: blur(8px);

    transition: opacity ${cssVar.motionDurationFast};

    *:hover > & {
      opacity: 1;
    }
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
   *
   * Filled buttons are translucent by design, so the row carries its own scrim:
   * a bottom-up fade that darkens whatever the character puts behind the labels
   * without boxing the buttons in a panel.
   */
  outputActions: css`
    position: absolute;
    z-index: 2;
    inset-block-end: 0;
    inset-inline: 0;

    padding-block: 40px 10px;
    padding-inline: 10px;

    opacity: 0;
    background: linear-gradient(
      to top,
      ${cssVar.colorBgContainer} 0%,
      color-mix(in srgb, ${cssVar.colorBgContainer} 76%, transparent) 46%,
      transparent 100%
    );

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
  /**
   * Breathing room so the head is not pinned to the slot's top edge. Far less
   * than the avatar's inset — a full body wants the height — but enough that the
   * slot reads as a frame around the character rather than a crop of it.
   */
  previewBodyImage: css`
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    padding-block: ${FULL_BODY_INSET}px;

    object-fit: contain;
  `,
  /**
   * Dashed marker for the share of the character the home surface actually
   * shows, so framing can be judged here instead of by walking to home.
   */
  framePreview: css`
    pointer-events: none;

    position: absolute;
    z-index: 3;
    inset-block-start: ${FULL_BODY_INSET}px;
    inset-inline: ${FULL_BODY_INSET}px;

    height: calc((100% - ${FULL_BODY_INSET * 2}px) * ${HOME_PORTRAIT_VISIBLE_RATIO});
    border: 1px dashed ${cssVar.colorTextSecondary};
    border-radius: ${cssVar.borderRadiusSM};
  `,
  framePreviewLabel: css`
    position: absolute;
    inset-block-end: 4px;
    inset-inline-end: 6px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 11px;
    line-height: 14px;
    color: ${cssVar.colorTextSecondary};
  `,
  frameToggle: css`
    position: absolute;
    z-index: 4;
    inset-block-start: 8px;
    inset-inline-start: 8px;

    opacity: 0;
    background: color-mix(in srgb, ${cssVar.colorBgContainer} 72%, transparent);
    backdrop-filter: blur(8px);

    transition: opacity ${cssVar.motionDurationMid};
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
    /** True when the user's own reference should drive the character. */
    useReference?: boolean,
  ) => void;
  /** Attaches (or clears, with `undefined`) the user's own generation reference. */
  onReferenceChange: (file?: File) => void;
  /** Clears the artwork in one slot. */
  onRemove: (composition: AgentArtworkComposition) => void;
  onUpload: (file: File, composition: AgentArtworkComposition) => void;
  /**
   * The user's own reference image, if they attached one. Selecting it makes a
   * generation follow that character instead of a style preset.
   */
  referenceImage?: string | null;
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
    onReferenceChange,
    onUpload,
    referenceImage,
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
    const referenceInputRef = useRef<HTMLInputElement>(null);
    // Off by default: the frame is a measuring tool, and leaving it drawn over
    // every artwork would make the slot read as cropped.
    const [showFramePreview, setShowFramePreview] = useState(false);
    // Resume the subject's own last choice; a preset that no longer exists
    // falls back rather than leaving the gallery with nothing selected.
    const [style, setStyle] = useState<AgentArtworkStyle>(() =>
      GALLERY_STYLES.includes(initialStyle as AgentArtworkStyle)
        ? (initialStyle as AgentArtworkStyle)
        : 'anime',
    );
    const [direction, setDirection] = useState(initialDirection ?? '');
    const [generateExpanded, setGenerateExpanded] = useState(true);
    // The gallery picks one source for the character: a preset, or the user's own
    // reference. Keeping the preset selected underneath means clearing the
    // reference lands back where they were instead of on nothing.
    const [useReference, setUseReference] = useState(false);
    const selectStyle = useCallback((next: AgentArtworkStyle) => {
      setStyle(next);
      setUseReference(false);
    }, []);

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
                      onGenerate(style, 'avatar', direction, useReference);
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
                {showFramePreview && fullBody ? (
                  <div className={styles.framePreview}>
                    <span className={styles.framePreviewLabel}>
                      {Math.round(HOME_PORTRAIT_VISIBLE_RATIO * 100)}%
                    </span>
                  </div>
                ) : null}
                {fullBody && !isGenerating('fullBody') ? (
                  <ActionIcon
                    data-slot-actions
                    active={showFramePreview}
                    className={styles.frameToggle}
                    icon={Frame}
                    size={'small'}
                    title={t('artworkStudio.framePreview')}
                    onClick={(event: MouseEvent<HTMLDivElement>) => {
                      event.stopPropagation();
                      setShowFramePreview((open) => !open);
                    }}
                  />
                ) : null}
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
                      onGenerate(style, 'fullBody', direction, useReference);
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
                        className={`${styles.galleryItem} ${style === item && !useReference ? styles.galleryItemActive : ''}`}
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
                        </div>
                        <Text ellipsis className={styles.galleryLabel}>
                          {t(`artworkStudio.style.${item}`)}
                        </Text>
                      </Flexbox>
                    ))}
                    {/*
                      A preset says "look like this kind of art"; this says "look
                      like THIS character". It sits in the same row because it is
                      the same choice — what the generation follows — and only one
                      of them can be in effect.
                    */}
                    <Flexbox
                      className={`${styles.galleryItem} ${useReference ? styles.galleryItemActive : ''}`}
                      gap={6}
                      role={'button'}
                      tabIndex={0}
                      onClick={() =>
                        referenceImage
                          ? setUseReference(true)
                          : referenceInputRef.current && openFilePicker(referenceInputRef.current)
                      }
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return;
                        event.preventDefault();
                        if (referenceImage) setUseReference(true);
                        else if (referenceInputRef.current)
                          openFilePicker(referenceInputRef.current);
                      }}
                    >
                      <div className={styles.galleryThumbWrap}>
                        {referenceImage ? (
                          <>
                            <img
                              alt={t('artworkStudio.reference.title')}
                              className={styles.galleryThumb}
                              src={referenceImage}
                            />
                            <ActionIcon
                              className={styles.referenceRemove}
                              icon={Trash2}
                              size={'small'}
                              title={t('artworkStudio.reference.remove')}
                              onClick={(event: MouseEvent<HTMLDivElement>) => {
                                event.stopPropagation();
                                setUseReference(false);
                                onReferenceChange();
                              }}
                            />
                          </>
                        ) : (
                          <Center className={styles.referenceEmpty}>
                            <Icon icon={ImagePlus} size={18} />
                          </Center>
                        )}
                      </div>
                      <Text ellipsis className={styles.galleryLabel}>
                        {t('artworkStudio.reference.title')}
                      </Text>
                    </Flexbox>
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
                      onClick={() => onGenerate(style, undefined, direction, useReference)}
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
        <input
          accept="image/*"
          aria-label={t('artworkStudio.reference.title')}
          className={styles.visuallyHiddenInput}
          ref={referenceInputRef}
          tabIndex={-1}
          type="file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            // Attaching one is also choosing it — nobody uploads a reference
            // they did not want the next generation to follow.
            setUseReference(true);
            onReferenceChange(file);
          }}
        />
      </Flexbox>
    );
  },
);

ArtworkStudioContent.displayName = 'ArtworkStudioContent';

export default ArtworkStudioContent;
