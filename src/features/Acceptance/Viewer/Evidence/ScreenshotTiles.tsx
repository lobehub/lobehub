'use client';

import { Flexbox, Icon, Image } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { Check, MessageSquare, X } from 'lucide-react';
import { memo, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { EvidenceOverlay } from './overlay';
import {
  annotationInSlice,
  isPortraitScreenshot,
  screenshotSliceObjectPosition,
  screenshotSlices,
  screenshotTileWidth,
} from './screenshotSlices';

const styles = createStaticStyles(({ css }) => ({
  badge: css`
    position: absolute;
    inset-block-start: -9px;
    inset-inline-start: -9px;

    display: inline-flex;
    align-items: center;
    justify-content: center;

    width: 18px;
    height: 18px;
    border-radius: 50%;

    font-size: 11px;
    font-weight: 600;
    line-height: 1;
    color: ${cssVar.colorTextLightSolid};
  `,
  frame: css`
    position: relative;

    overflow: hidden;
    flex: none;

    max-width: 100%;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
  `,
  frameFlat: css`
    border: none;
    border-radius: 0;
  `,
  /**
   * The clickable note slot, pinned to the region's OUTER right edge: the box
   * marks where the concern is, this marker is how you read it. Kept on the
   * right so it never covers the numbered badge on the opposite corner.
   */
  marker: css`
    pointer-events: auto;
    cursor: pointer;

    position: absolute;
    inset-block-start: -10px;
    inset-inline-end: -10px;

    display: inline-flex;
    align-items: center;
    justify-content: center;

    /* A circle, not a pill: the face inside is round, and a rounded rectangle
       hugging it reads as a squashed oval. Same 18px as the numbered badge on
       the opposite corner, so the two corners of one box match. */
    width: 18px;
    height: 18px;
    border: none;
    border-radius: 50%;

    font-size: 10px;
    font-weight: 600;
    line-height: 1;
    color: ${cssVar.colorTextLightSolid};

    box-shadow: ${cssVar.boxShadowTertiary};

    &:hover {
      filter: brightness(1.12);
    }
  `,
  markerActive: css`
    outline: 2px solid ${cssVar.colorTextLightSolid};
  `,
  /**
   * The opened note FLOATS rather than taking a column of its own: reserving
   * layout for it shoved the evidence narrower the moment anyone opened a note,
   * and closing it snapped the image back.
   *
   * Where it floats depends on the room beside the reading column. Given a wide
   * enough window it sits in the margin, clear of the screenshot — the note is
   * about the picture, so covering the picture with it is the one thing it must
   * not do. Below that it falls back to hugging the image's right edge, which
   * still beats pushing the evidence around.
   */
  note: css`
    position: absolute;
    z-index: 5;
    inset-inline-end: 12px;

    width: min(280px, 76%);
    padding: 12px;

    /* Room for the close control, so it never lands on the author's name. */
    padding-inline-end: 32px;

    /* No frame: an elevated surface is the whole affordance, the way Figma's
       comments read. A 1px box around content that already sits in a box is
       what made the earlier rounds look like wireframes. */
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgElevated};
    box-shadow: ${cssVar.boxShadowSecondary};

    /* 920px reading column + 240px note + gaps — the point where the margin
       can hold the note without the page growing a horizontal scrollbar. */
    @media (width >= 1440px) {
      inset-inline: calc(100% + 12px) auto;
      width: 240px;
    }
  `,
  /** Sits in the gutter the note reserves for it, clear of the panel's text. */
  noteClose: css`
    cursor: pointer;

    position: absolute;
    inset-block-start: 8px;
    inset-inline-end: 8px;

    display: inline-flex;
    align-items: center;
    justify-content: center;

    width: 20px;
    height: 20px;
    padding: 0;
    border: none;
    border-radius: ${cssVar.borderRadius};

    color: ${cssVar.colorTextTertiary};

    background: none;

    transition: all ${cssVar.motionDurationFast};

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }
  `,
  noteFallbackHead: css`
    padding-block-end: 4px;
  `,
  /**
   * The collapsed pin: while a note is shut there has to be something in the
   * margin saying it exists, or the only way to find a remark is to hunt for
   * the marker on the box it points at.
   */
  pin: css`
    cursor: pointer;

    position: absolute;
    z-index: 4;
    inset-inline-end: -14px;

    display: inline-flex;
    align-items: center;
    justify-content: center;

    width: 24px;
    height: 24px;
    border: none;
    border-radius: 50% 50% 50% 2px;

    color: ${cssVar.colorTextLightSolid};

    box-shadow: ${cssVar.boxShadowTertiary};

    &:hover {
      filter: brightness(1.12);
    }

    @media (width >= 1440px) {
      inset-inline: calc(100% + 12px) auto;
    }
  `,
  /** The avatar fills the pin; the pin's own colour stays visible as its rim. */
  pinFace: css`
    width: 18px;
    height: 18px;
    border-radius: 50%;
    object-fit: cover;
  `,
  pinInitial: css`
    font-size: 11px;
    font-weight: 600;
    line-height: 1;
  `,
  /** Positioning context for the floating note; the frame itself clips. */
  stage: css`
    position: relative;
  `,
  noteBody: css`
    font-size: 13px;
    line-height: 1.6;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  `,
  rect: css`
    pointer-events: none;

    position: absolute;

    border: 2px solid ${cssVar.colorError};
    border-radius: ${cssVar.borderRadiusXS};

    /*
     * Two rings instead of one: the dark outside separates the box from a white
     * screenshot, the light inside separates it from a dark one. The evidence
     * image can be either, and neither the hue nor the reader's theme can tell
     * us which — so the box carries its own contrast.
     */
    box-shadow:
      0 0 0 1px rgb(0 0 0 / 45%),
      inset 0 0 0 1px rgb(255 255 255 / 45%);
  `,
  swatch: css`
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
  `,
}));

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
    const color = annotation.resolved
      ? cssVar.colorTextQuaternary
      : (annotation.color ?? cssVar.colorError);
    const label = annotation.label ?? index + 1;
    return (
      <div
        className={styles.rect}
        style={{
          borderColor: color,
          height: `${rect.height * 100}%`,
          left: `${rect.x * 100}%`,
          top: `${rect.y * 100}%`,
          width: `${rect.width * 100}%`,
        }}
      >
        {numbered && (
          <span className={styles.badge} style={{ background: color }}>
            {label}
          </span>
        )}
        {annotation.comment && (
          <button
            className={cx(styles.marker, opened && styles.markerActive)}
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
          className={styles.pinFace}
          src={src}
          style={{ height: size, width: size }}
        />
      );
    const initial = name?.trim().slice(0, 1);
    if (initial)
      return (
        <span className={styles.pinInitial} style={{ fontSize: size < 16 ? 9 : 11 }}>
          {initial.toUpperCase()}
        </span>
      );
    return <Icon icon={MessageSquare} size={size < 16 ? 10 : 12} />;
  },
);

AnnotationFace.displayName = 'AcceptanceAnnotationFace';

interface ScreenshotTilesProps {
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
  ({ alt, annotations, caption, fileHeight, fileWidth, flat = false, src }) => {
    const { t } = useTranslation('verify');
    const [natural, setNatural] = useState(
      fileWidth && fileHeight ? { height: fileHeight, width: fileWidth } : undefined,
    );
    const [openedNote, setOpenedNote] = useState<number>();

    const slices = natural ? screenshotSlices(natural.width, natural.height) : undefined;
    const numbered =
      (annotations?.length ?? 0) > 1 || annotations?.some((item) => item.label !== undefined);
    const toggleNote = (index: number) =>
      setOpenedNote((current) => (current === index ? undefined : index));
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
        className={styles.note}
        style={{ insetBlockStart: `${Math.min(Math.max(opened.rect.y, 0), 0.62) * 100}%` }}
      >
        {/*
         * Opening a note hides every pin, including the one that opened it, so
         * without this the only way back is the small marker on the box itself
         * — findable if you know it is there, and nowhere near where the reader
         * is looking.
         */}
        <button
          className={styles.noteClose}
          title={t('acceptance.comments.collapseThread')}
          type={'button'}
          onClick={() => setOpenedNote(undefined)}
        >
          <Icon icon={X} size={12} />
        </button>
        {opened.panel ?? (
          <Flexbox gap={4}>
            <Flexbox horizontal align={'center'} className={styles.noteFallbackHead} gap={6}>
              <span
                className={styles.swatch}
                style={{ background: opened.color ?? cssVar.colorError }}
              />
              <Text fontSize={12} type={'secondary'}>
                {numbered ? `${opened.label ?? openedNote! + 1} · ` : ''}
                {opened.authorName}
              </Text>
            </Flexbox>
            <div className={styles.noteBody}>{opened.comment}</div>
          </Flexbox>
        )}
      </div>
    );

    const pins =
      openedNote === undefined &&
      annotations?.map((annotation, index) =>
        annotation.comment ? (
          <button
            className={styles.pin}
            key={index}
            title={annotation.authorName}
            type={'button'}
            style={{
              background: annotation.resolved
                ? cssVar.colorTextQuaternary
                : (annotation.color ?? cssVar.colorError),
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
        <div className={styles.stage}>
          {body}
          {pins}
          {note}
        </div>
        {caption}
      </Flexbox>
    );

    if (!natural) {
      return shell(
        '100%',
        <div
          className={cx(styles.frame, flat && styles.frameFlat)}
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
                className={cx(styles.frame, flat && styles.frameFlat)}
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
        className={cx(styles.frame, flat && styles.frameFlat)}
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
