'use client';

import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';

import { sx } from '@/styles/sx';

import type { Rotation } from '../../geometry';
import { anchorOrigin, type MarkupComment } from '../markup';

// Mirrors MARKER_COLOR in ../markup (also drawn into the exported image).
const MARKER = '#0a84ff';

export const markerStyles = stylex.create({
  pin: {
    cursor: 'pointer',
    position: 'absolute',
    zIndex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '24px',
    height: '24px',
    marginBlockStart: '-12px',
    marginInlineStart: '-12px',
    padding: 0,
    borderWidth: '2px',
    borderStyle: 'solid',
    borderColor: '#fff',
    borderRadius: '50%',
    fontSize: '11px',
    fontWeight: 600,
    color: '#fff',
    backgroundColor: MARKER,
    backgroundImage: 'none',
    boxShadow: cssVar.boxShadowSecondary,
    outlineColor: { 'default': null, ':focus-visible': cssVar.colorPrimaryBorder },
    outlineOffset: { 'default': null, ':focus-visible': '2px' },
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineWidth: { 'default': null, ':focus-visible': '2px' },
  },
  pinActive: { backgroundColor: cssVar.colorWarning },
  region: {
    pointerEvents: 'none',
    position: 'absolute',
    borderWidth: '2px',
    borderStyle: 'dashed',
    borderColor: MARKER,
    borderRadius: '2px',
    backgroundColor: `color-mix(in srgb, ${MARKER} 8%, transparent)`,
    backgroundImage: 'none',
  },
  regionActive: { borderColor: cssVar.colorWarning },
});

interface CommentMarkersProps {
  activeId?: string;
  comments: MarkupComment[];
  /** Read-only markers ignore the pointer, so the layer under them keeps working. */
  onSelect?: (id: string) => void;
  rotation: Rotation;
}

/**
 * Numbered markers for the comments on the image: a pin at a point, or a
 * dashed box with its pin at the top-left corner. The numbers match the ones
 * drawn into the exported image and the lines of the chat message.
 */
const CommentMarkers = ({ activeId, comments, onSelect, rotation }: CommentMarkersProps) => {
  const { t } = useTranslation('file');
  // Markers sit inside the rotated frame; turning them back keeps labels upright.
  const upright = { transform: `rotate(${-rotation}deg)` };

  return comments.map((comment, index) => {
    const origin = anchorOrigin(comment.anchor);
    const active = activeId === comment.id;
    return (
      <span key={comment.id}>
        {comment.anchor.type === 'region' && (
          <span
            data-active={active}
            data-testid={'image-comment-region'}
            {...sx([markerStyles.region, active && markerStyles.regionActive], undefined, {
              height: `${comment.anchor.rect.height * 100}%`,
              left: `${comment.anchor.rect.x * 100}%`,
              top: `${comment.anchor.rect.y * 100}%`,
              width: `${comment.anchor.rect.width * 100}%`,
            })}
          />
        )}
        <button
          aria-label={t('imageViewer.comment.pin', { index: index + 1 })}
          data-active={active}
          tabIndex={onSelect ? undefined : -1}
          title={comment.text}
          type={'button'}
          {...sx([markerStyles.pin, active && markerStyles.pinActive], undefined, {
            left: `${origin.x * 100}%`,
            pointerEvents: onSelect ? undefined : 'none',
            top: `${origin.y * 100}%`,
            ...upright,
          })}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onSelect?.(comment.id);
          }}
        >
          {index + 1}
        </button>
      </span>
    );
  });
};

export default CommentMarkers;
