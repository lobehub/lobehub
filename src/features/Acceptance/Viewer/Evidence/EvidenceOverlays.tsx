'use client';

import { Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Check, MessageSquare, X } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { sx } from '@/styles/sx';

import { type EvidenceOverlay, overlayColor } from './overlay';

const styles = stylex.create({
  badge: {
    position: 'absolute',
    insetBlockStart: '-10px',
    insetInlineStart: '-10px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '20px',
    height: '20px',
    borderRadius: '50%',
    fontSize: '12px',
    fontWeight: 600,
    lineHeight: 1,
    color: cssVar.colorTextLightSolid,
  },
  marker: {
    pointerEvents: 'auto',
    cursor: 'pointer',
    position: 'absolute',
    insetBlockStart: '-10px',
    insetInlineEnd: '-10px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '20px',
    height: '20px',
    borderStyle: 'none',
    borderRadius: '50%',
    fontSize: '12px',
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
  noteBody: { fontSize: '14px', lineHeight: 1.6, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' },
  pinFace: { borderRadius: '50%', objectFit: 'cover' },
  pinInitial: { fontSize: '12px', fontWeight: 600, lineHeight: 1 },
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

/**
 * The author inside a pin. An avatar when we have one, their initial when we
 * do not, and the speech bubble only when the author is unknown — a pin with
 * no face is indistinguishable from the next pin along.
 */
export const AnnotationFace = memo<{ name?: string; size?: number; src?: string | null }>(
  ({ name, size = 18, src }) => {
    if (src)
      return (
        <img alt={name ?? ''} src={src} {...sx(styles.pinFace, { height: size, width: size })} />
      );
    const initial = name?.trim().slice(0, 1);
    if (initial) return <span {...stylex.props(styles.pinInitial)}>{initial.toUpperCase()}</span>;
    return <Icon icon={MessageSquare} size={12} />;
  },
);

AnnotationFace.displayName = 'AcceptanceAnnotationFace';

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

export const OverlayRect = memo<OverlayRectProps>(
  ({ annotation, index, numbered, onToggle, opened, rect }) => {
    // A settled region keeps its place but drops its author's colour: an
    // answered note should not compete with an open one for attention.
    const color = overlayColor(annotation);
    const label = annotation.label ?? index + 1;
    return (
      <div
        {...sx(styles.rect, {
          borderColor: color,
          height: `${rect.height * 100}%`,
          left: `${rect.x * 100}%`,
          top: `${rect.y * 100}%`,
          width: `${rect.width * 100}%`,
        })}
      >
        {numbered && <span {...sx(styles.badge, { background: color })}>{label}</span>}
        {annotation.comment && (
          <button
            title={annotation.authorName}
            type={'button'}
            {...sx(styles.marker, opened && styles.markerActive, { background: color })}
            onClick={() => onToggle(index)}
          >
            {annotation.resolved ? (
              <Icon icon={Check} size={12} />
            ) : (
              <AnnotationFace
                name={annotation.authorName}
                size={16}
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

interface OverlayNoteContentProps {
  /** The badge number when regions are numbered. */
  label?: number;
  onClose: () => void;
  opened: EvidenceOverlay;
}

export const OverlayNoteContent = memo<OverlayNoteContentProps>(({ label, onClose, opened }) => {
  const { t } = useTranslation('verify');

  return (
    <>
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
        onClick={onClose}
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
            <span {...sx(styles.swatch, { background: opened.color ?? cssVar.colorError })} />
            <Text fontSize={12} type={'secondary'}>
              {label === undefined ? '' : `${label} · `}
              {opened.authorName}
            </Text>
          </Flexbox>
          <div {...stylex.props(styles.noteBody)}>{opened.comment}</div>
        </Flexbox>
      )}
    </>
  );
});

OverlayNoteContent.displayName = 'AcceptanceOverlayNoteContent';
