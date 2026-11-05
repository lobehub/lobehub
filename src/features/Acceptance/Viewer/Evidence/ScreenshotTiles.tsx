'use client';

import { Flexbox, Icon, Image, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Check, MessageSquare, X } from 'lucide-react';
import { memo, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useOptionalAcceptanceScope } from '../AcceptanceScope';
import { commentAnchorId } from '../Comments/anchor';
import { floatingActionHostMarker } from '../markers.stylex';
import { type EvidenceOverlay, overlayColor } from './overlay';
import {
  annotationInSlice,
  isPortraitScreenshot,
  screenshotSliceObjectPosition,
  screenshotSlices,
  screenshotTileWidth,
} from './screenshotSlices';
import { useImageThreads } from './useImageThreads';

const styles = stylex.create({
  badge: {
    position: 'absolute',
    insetBlockStart: '-9px',
    insetInlineStart: '-9px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '18px',
    height: '18px',
    borderRadius: '50%',
    fontSize: '11px',
    fontWeight: 600,
    lineHeight: 1,
    color: cssVar.colorTextLightSolid,
  },
  frame: {
    position: 'relative',
    overflow: 'hidden',
    flex: 'none',
    maxWidth: '100%',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
  },
  frameFlat: { borderStyle: 'none', borderRadius: '0' },
  marker: {
    pointerEvents: 'auto',
    cursor: 'pointer',
    position: 'absolute',
    insetBlockStart: '-10px',
    insetInlineEnd: '-10px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '18px',
    height: '18px',
    borderStyle: 'none',
    borderRadius: '50%',
    fontSize: '10px',
    fontWeight: 600,
    lineHeight: 1,
    color: cssVar.colorTextLightSolid,
    boxShadow: cssVar.boxShadowTertiary,
    filter: { 'default': null, ':hover': 'brightness(1.12)' },
  },
  markerActive: {
    outlineWidth: '2px',
    outlineStyle: 'solid',
    outlineColor: cssVar.colorTextLightSolid,
  },
  note: {
    position: 'absolute',
    zIndex: 5,
    insetInlineEnd: { 'default': '12px', '@media (width >= 1440px)': 'auto' },
    width: { 'default': 'min(280px, 76%)', '@media (width >= 1440px)': '240px' },
    padding: '12px',
    paddingInlineEnd: '32px',
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorBgElevated,
    backgroundImage: 'none',
    boxShadow: cssVar.boxShadowSecondary,
    insetInlineStart: { 'default': null, '@media (width >= 1440px)': 'calc(100% + 12px)' },
  },
  noteClose: {
    cursor: 'pointer',
    position: 'absolute',
    insetBlockStart: '8px',
    insetInlineEnd: '8px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '20px',
    height: '20px',
    padding: '0',
    borderStyle: 'none',
    borderRadius: cssVar.borderRadius,
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorText },
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': 'none', ':hover': 'none' },
    transition: `all ${cssVar.motionDurationFast}`,
  },
  noteFallbackHead: { paddingBlockEnd: '4px' },
  pin: {
    cursor: 'pointer',
    position: 'absolute',
    zIndex: 4,
    insetInlineEnd: { 'default': '-14px', '@media (width >= 1440px)': 'auto' },
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '24px',
    height: '24px',
    borderStyle: 'none',
    borderTopLeftRadius: '50%',
    borderTopRightRadius: '50%',
    borderBottomRightRadius: '50%',
    borderBottomLeftRadius: '2px',
    color: cssVar.colorTextLightSolid,
    boxShadow: cssVar.boxShadowTertiary,
    filter: { 'default': null, ':hover': 'brightness(1.12)' },
    insetInlineStart: { 'default': null, '@media (width >= 1440px)': 'calc(100% + 12px)' },
  },
  pinFace: { width: '18px', height: '18px', borderRadius: '50%', objectFit: 'cover' },
  pinInitial: { fontSize: '11px', fontWeight: 600, lineHeight: 1 },
  stage: { position: 'relative' },
  noteBody: { fontSize: '13px', lineHeight: 1.6, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' },
  rect: {
    pointerEvents: 'none',
    position: 'absolute',
    borderWidth: '2px',
    borderStyle: 'solid',
    borderColor: cssVar.colorError,
    borderRadius: cssVar.borderRadiusXS,
    boxShadow: '0 0 0 1px rgb(0 0 0 / 45%),\n      inset 0 0 0 1px rgb(255 255 255 / 45%)',
  },
  swatch: { flex: 'none', width: '8px', height: '8px', borderRadius: '50%' },
});

interface OverlayRectProps {
  annotation: EvidenceOverlay;
  /** Index within the whole image, so the marker and the note agree. */
  index: number;
  numbered: boolean;
  onToggle: (index: number) => void;
  opened: boolean;
  /** Region geometry for THIS tile — a sliced screenshot clips it per tile. */
  rect: EvidenceOverlay['rect'];
}

const OverlayRect = memo<OverlayRectProps>(
  ({ annotation, index, numbered, onToggle, opened, rect }) => {
    // A settled region keeps its place but drops its author's colour: an
    // answered note should not compete with an open one for attention.
    const color = overlayColor(annotation);
    const label = annotation.label ?? index + 1;
    return (
      <div
        className={stylex.props(styles.rect).className}
        style={{
          borderColor: color,
          height: `${rect.height * 100}%`,
          left: `${rect.x * 100}%`,
          top: `${rect.y * 100}%`,
          width: `${rect.width * 100}%`,
        }}
      >
        {numbered && (
          <span className={stylex.props(styles.badge).className} style={{ background: color }}>
            {label}
          </span>
        )}
        {annotation.comment && (
          <button
            className={stylex.props(styles.marker, opened && styles.markerActive).className}
            style={{ background: color }}
            title={annotation.authorName}
            type={'button'}
            onClick={() => onToggle(index)}
          >
            {annotation.resolved ? (
              <Icon icon={Check} size={10} />
            ) : (
              <AnnotationFace
                name={annotation.authorName}
                size={14}
                src={annotation.authorAvatar}
              />
            )}
          </button>
        )}
      </div>
    );
  },
);

OverlayRect.displayName = 'AcceptanceOverlayRect';

/**
 * The author inside a pin. An avatar when we have one, their initial when we
 * do not, and the speech bubble only when the author is unknown — a pin with
 * no face is indistinguishable from the next pin along.
 */
const AnnotationFace = memo<{ name?: string; size?: number; src?: string | null }>(
  ({ name, size = 18, src }) => {
    if (src)
      return (
        <img
          alt={name ?? ''}
          className={stylex.props(styles.pinFace).className}
          src={src}
          style={{ height: size, width: size }}
        />
      );
    const initial = name?.trim().slice(0, 1);
    if (initial)
      return (
        <span
          className={stylex.props(styles.pinInitial).className}
          style={{ fontSize: size < 16 ? 9 : 11 }}
        >
          {initial.toUpperCase()}
        </span>
      );
    return <Icon icon={MessageSquare} size={size < 16 ? 10 : 12} />;
  },
);

AnnotationFace.displayName = 'AcceptanceAnnotationFace';

interface ScreenshotTilesProps {
  /** Floats over the picture (see `FloatingCommentAction`). */
  action?: ReactNode;
  alt: string;
  annotations?: EvidenceOverlay[];
  caption?: ReactNode;
  fileHeight?: number | null;
  fileWidth?: number | null;
  /** The surrounding comparison card already frames the screenshot. */
  flat?: boolean;
  src: string;
}

export const ScreenshotTiles = memo<ScreenshotTilesProps>(
  ({ action, alt, annotations, caption, fileHeight, fileWidth, flat = false, src }) => {
    const { t } = useTranslation('verify');
    const [natural, setNatural] = useState(
      fileWidth && fileHeight ? { height: fileHeight, width: fileWidth } : undefined,
    );
    const scope = useOptionalAcceptanceScope();
    const { openedNote, toggleNote, close } = useImageThreads(annotations, scope?.embedded);

    const slices = natural ? screenshotSlices(natural.width, natural.height) : undefined;
    const numbered =
      (annotations?.length ?? 0) > 1 || annotations?.some((item) => item.label !== undefined);
    const opened = openedNote === undefined ? undefined : annotations?.[openedNote];

    const rememberSize = (event: { currentTarget: HTMLImageElement }) => {
      if (natural) return;
      setNatural({
        height: event.currentTarget.naturalHeight,
        width: event.currentTarget.naturalWidth,
      });
    };

    // Pinned near the region it belongs to, but never so low that the panel
    // hangs off the bottom of the image.
    const note = opened && (
      <div
        className={stylex.props(styles.note).className}
        id={opened.threadId ? commentAnchorId(opened.threadId) : undefined}
        style={{ insetBlockStart: `${Math.min(Math.max(opened.rect.y, 0), 0.62) * 100}%` }}
      >
        {/*
         * Opening a note hides every pin, including the one that opened it, so
         * without this the only way back is the small marker on the box itself
         * — findable if you know it is there, and nowhere near where the reader
         * is looking.
         */}
        <button
          {...stylex.props(styles.noteClose)}
          title={t('acceptance.comments.collapseThread')}
          type={'button'}
          onClick={close}
        >
          <Icon icon={X} size={12} />
        </button>
        {opened.panel ?? (
          <Flexbox gap={4}>
            <Flexbox
              horizontal
              align={'center'}
              className={stylex.props(styles.noteFallbackHead).className}
              gap={6}
            >
              <span
                className={stylex.props(styles.swatch).className}
                style={{ background: opened.color ?? cssVar.colorError }}
              />
              <Text fontSize={12} type={'secondary'}>
                {numbered ? `${opened.label ?? openedNote! + 1} · ` : ''}
                {opened.authorName}
              </Text>
            </Flexbox>
            <div {...stylex.props(styles.noteBody)}>{opened.comment}</div>
          </Flexbox>
        )}
      </div>
    );

    const pins =
      openedNote === undefined &&
      annotations?.map((annotation, index) =>
        annotation.comment ? (
          <button
            className={stylex.props(styles.pin).className}
            key={index}
            title={annotation.authorName}
            type={'button'}
            style={{
              background: overlayColor(annotation),
              insetBlockStart: `${Math.min(Math.max(annotation.rect.y, 0), 0.86) * 100}%`,
            }}
            onClick={() => toggleNote(index)}
          >
            {annotation.resolved ? (
              <Icon icon={Check} size={12} />
            ) : (
              <AnnotationFace name={annotation.authorName} src={annotation.authorAvatar} />
            )}
          </button>
        ) : null,
      );

    const shell = (width: string | number, body: ReactNode) => (
      <Flexbox gap={4} style={{ maxWidth: '100%', width }}>
        <div {...stylex.props(styles.stage, action ? floatingActionHostMarker : null)}>
          {body}
          {pins}
          {note}
          {action}
        </div>
        {caption}
      </Flexbox>
    );

    if (!natural) {
      return shell(
        '100%',
        <div
          className={stylex.props(styles.frame, flat && styles.frameFlat).className}
          style={{ maxWidth: '100%', width: '100%' }}
        >
          <Image
            alt={alt}
            loading={'lazy'}
            src={src}
            style={flat ? { borderRadius: 0 } : undefined}
            variant={'borderless'}
            width={'100%'}
            onLoad={rememberSize}
          />
        </div>,
      );
    }

    if (slices) {
      return shell(
        '100%',
        <Flexbox horizontal align={'flex-start'} gap={12} wrap={'wrap'}>
          {slices.map((slice) => {
            const local = annotations
              ?.map((annotation, index) => {
                const rect = annotationInSlice(annotation.rect, slice, natural.height);
                if (!rect) return;
                return { annotation, index, rect };
              })
              .filter((item) => item !== undefined);

            return (
              <div
                className={stylex.props(styles.frame, flat && styles.frameFlat).className}
                key={slice.index}
                style={{
                  aspectRatio: `${natural.width} / ${slice.height}`,
                  width: screenshotTileWidth(natural.width),
                }}
              >
                <Image
                  alt={alt}
                  height={'100%'}
                  loading={'lazy'}
                  maxHeight={'none'}
                  maxWidth={'none'}
                  objectFit={'cover'}
                  src={src}
                  style={{ borderRadius: flat ? 0 : undefined, height: '100%', width: '100%' }}
                  variant={'borderless'}
                  width={'100%'}
                  styles={{
                    image: {
                      height: '100%',
                      objectPosition: screenshotSliceObjectPosition(slice, natural.height),
                      width: '100%',
                    },
                    wrapper: { height: '100%', width: '100%' },
                  }}
                />
                {local?.map((item) => (
                  <OverlayRect
                    annotation={item.annotation}
                    index={item.index}
                    key={item.index}
                    numbered={Boolean(numbered)}
                    opened={openedNote === item.index}
                    rect={item.rect}
                    onToggle={toggleNote}
                  />
                ))}
              </div>
            );
          })}
        </Flexbox>,
      );
    }

    const portrait = isPortraitScreenshot(natural.width, natural.height);

    return shell(
      portrait ? screenshotTileWidth(natural.width) : '100%',
      <div
        className={stylex.props(styles.frame, flat && styles.frameFlat).className}
        style={{
          aspectRatio: `${natural.width} / ${natural.height}`,
          maxWidth: '100%',
          width: '100%',
        }}
      >
        <Image
          alt={alt}
          loading={'lazy'}
          maxHeight={'none'}
          maxWidth={'none'}
          objectFit={'contain'}
          src={src}
          style={{ borderRadius: flat ? 0 : undefined, width: '100%' }}
          variant={'borderless'}
          width={'100%'}
        />
        {annotations?.map((annotation, index) => (
          <OverlayRect
            annotation={annotation}
            index={index}
            key={index}
            numbered={Boolean(numbered)}
            opened={openedNote === index}
            rect={annotation.rect}
            onToggle={toggleNote}
          />
        ))}
      </div>,
    );
  },
);

ScreenshotTiles.displayName = 'AcceptanceScreenshotTiles';
