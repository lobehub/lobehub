'use client';

import { imageUrl } from '@lobechat/const';
import type { AgentArtworkComposition, AgentArtworkStyle } from '@lobechat/prompts';
import { AGENT_ARTWORK_STYLES } from '@lobechat/prompts';
import {
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  AccordionRoot,
  AccordionTrigger,
  ActionIcon,
  Alert,
  Avatar,
  Button,
  Center,
  Flexbox,
  Icon,
  Input,
  Spin,
  Text,
  useModalContext,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
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

const styles = stylex.create({
  galleryGrid: { display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'start' },
  // The marker for `galleryThumb`, which brightens while its item is hovered.
  galleryItem: {
    cursor: 'pointer',
    width: `${STYLE_THUMB_SIZE + 8}px`,
    padding: '4px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'transparent',
    borderRadius: cssVar.borderRadiusLG,
    transition: `border-color ${cssVar.motionDurationFast}, background ${cssVar.motionDurationFast}`,
  },
  galleryItemActive: {
    borderColor: cssVar.colorPrimary,
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
  galleryLabel: {
    fontSize: '12px',
    lineHeight: '16px',
    color: cssVar.colorTextSecondary,
    textAlign: 'center',
  },
  galleryThumb: {
    aspectRatio: '1',
    width: `${STYLE_THUMB_SIZE}px`,
    borderRadius: cssVar.borderRadiusLG,
    filter: { default: null, [stylex.when.ancestor(':hover')]: 'brightness(1.06)' },
    objectFit: 'cover',
    transition: `filter ${cssVar.motionDurationFast}`,
  },
  // The marker for `referenceRemove`, which shows while the thumbnail is hovered.
  galleryThumbWrap: { position: 'relative' },
  referenceEmpty: {
    aspectRatio: '1',
    width: `${STYLE_THUMB_SIZE}px`,
    borderWidth: '1px',
    borderStyle: 'dashed',
    borderColor: cssVar.colorBorder,
    borderRadius: cssVar.borderRadiusLG,
    color: cssVar.colorTextTertiary,
  },
  referenceRemove: {
    position: 'absolute',
    zIndex: 1,
    insetBlockStart: '2px',
    insetInlineEnd: '2px',
    opacity: { default: 0, [stylex.when.ancestor(':hover')]: 1 },
    backgroundColor: `color-mix(in srgb, ${cssVar.colorBgContainer} 72%, transparent)`,
    backgroundImage: 'none',
    backdropFilter: 'blur(8px)',
    transition: `opacity ${cssVar.motionDurationFast}`,
  },
  generationOverlay: {
    position: 'absolute',
    zIndex: 2,
    inset: '0',
    padding: '12px',
    borderRadius: `calc(${cssVar.borderRadiusLG} - 1px)`,
    backgroundColor: `color-mix(in srgb, ${cssVar.colorBgContainer} 88%, transparent)`,
    backgroundImage: 'none',
    backdropFilter: 'blur(12px)',
  },
  generationOverlayTitle: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: '2',
    fontSize: '13px',
    fontWeight: 500,
    lineHeight: '18px',
    textAlign: 'center',
  },
  hint: { fontSize: '13px', color: cssVar.colorTextSecondary },
  noModelBlock: {
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  outputCard: { cursor: 'pointer', paddingBlock: '0', paddingInline: '8px' },
  outputActions: {
    position: 'absolute',
    zIndex: 2,
    insetBlockEnd: '0',
    insetInline: '0',
    paddingBlockStart: '40px',
    paddingBlockEnd: '10px',
    paddingInline: '10px',
    opacity: {
      default: 0,
      [stylex.when.ancestor(':hover')]: 1,
      [stylex.when.ancestor(':focus-within')]: 1,
    },
    backgroundColor: 'transparent',
    backgroundImage: `linear-gradient(to top, ${cssVar.colorBgContainer} 0%, color-mix(in srgb, ${cssVar.colorBgContainer} 76%, transparent) 46%, transparent 100%)`,
    transition: `opacity ${cssVar.motionDurationMid}`,
  },
  outputColumn: { width: '100%', height: '100%' },
  outputGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: '24px',
    alignItems: 'stretch',
  },
  // The marker for the slot's actions, shown on hover or keyboard focus.
  outputPreview: {
    position: 'relative',
    overflow: 'hidden',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  outputPreviewAvatar: { aspectRatio: '1', width: '100%', maxWidth: `${PREVIEW_MAX_SIZE}px` },
  outputPreviewFullBody: {
    aspectRatio: '3 / 4',
    maxWidth: '100%',
    height: '100%',
    maxHeight: `${PREVIEW_MAX_SIZE}px`,
  },
  previewBodyImage: {
    boxSizing: 'border-box',
    width: '100%',
    height: '100%',
    paddingBlock: `${FULL_BODY_INSET}px`,
    objectFit: 'contain',
  },
  framePreview: {
    pointerEvents: 'none',
    position: 'absolute',
    zIndex: 3,
    insetBlockStart: `${FULL_BODY_INSET}px`,
    insetInline: `${FULL_BODY_INSET}px`,
    borderWidth: '1px',
    borderStyle: 'dashed',
    borderColor: cssVar.colorTextSecondary,
    borderRadius: cssVar.borderRadiusSM,
  },
  // The visible share comes from Home's framing, which StyleX cannot read at build time.
  framePreviewHeight: (ratio: number) => ({
    height: `calc((100% - ${FULL_BODY_INSET * 2}px) * ${ratio})`,
  }),
  framePreviewLabel: {
    position: 'absolute',
    insetBlockEnd: '4px',
    insetInlineEnd: '6px',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '11px',
    lineHeight: '14px',
    color: cssVar.colorTextSecondary,
  },
  frameToggle: {
    position: 'absolute',
    zIndex: 4,
    insetBlockStart: '8px',
    insetInlineStart: '8px',
    opacity: {
      default: 0,
      [stylex.when.ancestor(':hover')]: 1,
      [stylex.when.ancestor(':focus-within')]: 1,
    },
    backgroundColor: `color-mix(in srgb, ${cssVar.colorBgContainer} 72%, transparent)`,
    backgroundImage: 'none',
    backdropFilter: 'blur(8px)',
    transition: `opacity ${cssVar.motionDurationMid}`,
  },
  controlLabel: { fontSize: '12px', lineHeight: '16px', color: cssVar.colorTextTertiary },
  removeButton: {
    position: 'absolute',
    zIndex: 2,
    insetBlockStart: '8px',
    insetInlineEnd: '8px',
    opacity: {
      default: 0,
      [stylex.when.ancestor(':hover')]: 1,
      [stylex.when.ancestor(':focus-within')]: 1,
    },
    backgroundColor: `color-mix(in srgb, ${cssVar.colorBgContainer} 72%, transparent)`,
    backgroundImage: 'none',
    backdropFilter: 'blur(8px)',
    transition: `opacity ${cssVar.motionDurationMid}`,
  },
  sectionTitle: { fontWeight: 500 },
  uploadSpec: {
    fontSize: '12px',
    lineHeight: '16px',
    color: cssVar.colorTextQuaternary,
    textAlign: 'center',
  },
  visuallyHiddenInput: {
    pointerEvents: 'none',
    position: 'fixed',
    overflow: 'hidden',
    width: '1px',
    height: '1px',
    opacity: 0,
  },
});

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
          className={stylex.props(styles.removeButton).className}
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
        <Center className={stylex.props(styles.generationOverlay).className} gap={8}>
          <Spin size="middle" variant="network" />
          <Text className={stylex.props(styles.generationOverlayTitle).className}>
            {generatingTitle}
          </Text>
          <Button size={'small'} type={'fill'} onClick={onCancel}>
            {t('artworkStudio.cancel')}
          </Button>
        </Center>
      ) : null;

    return (
      <Flexbox gap={24} padding={24}>
        <div {...stylex.props(styles.outputGrid)}>
          <Flexbox
            align={'center'}
            className={stylex.props(styles.outputCard).className}
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
              <Text className={stylex.props(styles.sectionTitle).className}>
                {t('artworkStudio.composition.avatar')}
              </Text>
            </Flexbox>
            <Flexbox
              align={'center'}
              className={stylex.props(styles.outputColumn).className}
              gap={10}
            >
              <Center
                className={
                  stylex.props(
                    styles.outputPreview,
                    styles.outputPreviewAvatar,
                    stylex.defaultMarker(),
                  ).className
                }
              >
                <AvatarSlotImage avatar={avatar} />
                {renderRemove('avatar', !!hasStoredAvatar)}
                <Flexbox
                  horizontal
                  className={stylex.props(styles.outputActions).className}
                  gap={8}
                >
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
              <Text className={stylex.props(styles.uploadSpec).className}>
                {t('artworkStudio.uploadSpec.avatar')}
              </Text>
            </Flexbox>
          </Flexbox>
          <Flexbox
            align={'center'}
            className={stylex.props(styles.outputCard).className}
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
              <Text className={stylex.props(styles.sectionTitle).className}>
                {t('artworkStudio.composition.fullBody')}
              </Text>
            </Flexbox>
            <Flexbox
              align={'center'}
              className={stylex.props(styles.outputColumn).className}
              gap={10}
            >
              <Center
                className={
                  stylex.props(
                    styles.outputPreview,
                    styles.outputPreviewFullBody,
                    stylex.defaultMarker(),
                  ).className
                }
              >
                {fullBody ? (
                  <img
                    alt={t('artworkStudio.preview.fullBody')}
                    {...stylex.props(styles.previewBodyImage)}
                    src={fullBody}
                  />
                ) : (
                  <Icon icon={PersonStanding} size={64} />
                )}
                {showFramePreview && fullBody ? (
                  <div
                    {...stylex.props(
                      styles.framePreview,
                      styles.framePreviewHeight(HOME_PORTRAIT_VISIBLE_RATIO),
                    )}
                  >
                    <span {...stylex.props(styles.framePreviewLabel)}>
                      {Math.round(HOME_PORTRAIT_VISIBLE_RATIO * 100)}%
                    </span>
                  </div>
                ) : null}
                {fullBody && !isGenerating('fullBody') ? (
                  <ActionIcon
                    active={showFramePreview}
                    className={stylex.props(styles.frameToggle).className}
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
                <Flexbox
                  horizontal
                  className={stylex.props(styles.outputActions).className}
                  gap={8}
                >
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
              <Text className={stylex.props(styles.uploadSpec).className}>
                {t('artworkStudio.uploadSpec.fullBody')}
              </Text>
            </Flexbox>
          </Flexbox>
        </div>

        {generating ? (
          <Text className={stylex.props(styles.hint).className} style={{ textAlign: 'center' }}>
            {t('artworkStudio.generatingHint')}
          </Text>
        ) : null}

        {canGenerate ? (
          <>
            <AccordionRoot
              indicatorPlacement="inline"
              style={{ gap: 4 }}
              value={generateExpanded ? [GENERATE_SECTION_KEY] : []}
              onValueChange={(keys) => setGenerateExpanded(keys.length > 0)}
            >
              <AccordionItem value={GENERATE_SECTION_KEY}>
                <AccordionHeader>
                  <AccordionTrigger style={{ paddingBlock: 2, paddingInline: 0 }}>
                    <Text className={stylex.props(styles.controlLabel).className}>
                      {t('artworkStudio.generateTitle')}
                    </Text>
                  </AccordionTrigger>
                </AccordionHeader>
                <AccordionPanel>
                  <Flexbox gap={12} paddingBlock={'4px 0'}>
                    <div {...stylex.props(styles.galleryGrid)}>
                      {GALLERY_STYLES.map((item) => (
                        <Flexbox
                          gap={6}
                          key={item}
                          role={'button'}
                          tabIndex={0}
                          className={
                            stylex.props(
                              styles.galleryItem,
                              style === item && !useReference && styles.galleryItemActive,
                              stylex.defaultMarker(),
                            ).className
                          }
                          onClick={() => selectStyle(item)}
                          onKeyDown={keySelect(item)}
                        >
                          <div {...stylex.props(styles.galleryThumbWrap, stylex.defaultMarker())}>
                            <img
                              alt={t(`artworkStudio.style.${item}`)}
                              {...stylex.props(styles.galleryThumb)}
                              src={
                                item === 'lobe'
                                  ? LOBE_STYLE_PREVIEW
                                  : imageUrl(`agent-artwork-styles/style-${item}.webp`)
                              }
                            />
                          </div>
                          <Text ellipsis className={stylex.props(styles.galleryLabel).className}>
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
                        gap={6}
                        role={'button'}
                        tabIndex={0}
                        className={
                          stylex.props(
                            styles.galleryItem,
                            useReference && styles.galleryItemActive,
                            stylex.defaultMarker(),
                          ).className
                        }
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
                        <div {...stylex.props(styles.galleryThumbWrap, stylex.defaultMarker())}>
                          {referenceImage ? (
                            <>
                              <img
                                alt={t('artworkStudio.reference.title')}
                                {...stylex.props(styles.galleryThumb)}
                                src={referenceImage}
                              />
                              <ActionIcon
                                className={stylex.props(styles.referenceRemove).className}
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
                            <Center className={stylex.props(styles.referenceEmpty).className}>
                              <Icon icon={ImagePlus} size={18} />
                            </Center>
                          )}
                        </div>
                        <Text ellipsis className={stylex.props(styles.galleryLabel).className}>
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
                </AccordionPanel>
              </AccordionItem>
            </AccordionRoot>
          </>
        ) : (
          <Center
            className={stylex.props(styles.noModelBlock).className}
            flex={1}
            gap={12}
            padding={24}
          >
            <Text className={stylex.props(styles.hint).className} style={{ textAlign: 'center' }}>
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
          {...stylex.props(styles.visuallyHiddenInput)}
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
          {...stylex.props(styles.visuallyHiddenInput)}
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
          {...stylex.props(styles.visuallyHiddenInput)}
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
