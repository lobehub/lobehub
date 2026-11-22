'use client';

import { Flexbox, Icon, Image } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Check } from 'lucide-react';
import { memo, type ReactNode, useState } from 'react';

import { comparisonMedia } from '../../Report/EvidenceComparisonCard';
import { useOptionalAcceptanceScope } from '../AcceptanceScope';
import { commentAnchorId } from '../Comments/anchor';
import { floatingActionHostMarker } from '../markers.stylex';
import { AnnotationFace, OverlayNoteContent, OverlayRect } from './EvidenceOverlays';
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
  stage: { position: 'relative' },
});

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
        <OverlayNoteContent
          label={numbered ? (opened.label ?? openedNote! + 1) : undefined}
          opened={opened}
          onClose={close}
        />
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
            {...(flat ? comparisonMedia.image : undefined)}
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
                  {...(flat ? comparisonMedia.image : undefined)}
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
          {...(flat ? comparisonMedia.image : undefined)}
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
