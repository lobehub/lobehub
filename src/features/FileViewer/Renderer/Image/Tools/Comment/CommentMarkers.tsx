'use client';

import { createStaticStyles, cssVar } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import type { Rotation } from '../../geometry';
import { anchorOrigin, MARKER_COLOR, type MarkupComment } from '../markup';

export const markerStyles = createStaticStyles(({ css }) => ({
  pin: css`
    cursor: pointer;

    position: absolute;
    z-index: 1;

    display: flex;
    align-items: center;
    justify-content: center;

    width: 24px;
    height: 24px;
    margin-block-start: -12px;
    margin-inline-start: -12px;
    padding: 0;
    border: 2px solid #fff;
    border-radius: 50%;

    font-size: 11px;
    font-weight: 600;
    color: #fff;

    background: ${MARKER_COLOR};
    box-shadow: ${cssVar.boxShadowSecondary};

    &[data-active='true'] {
      background: ${cssVar.colorWarning};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimaryBorder};
      outline-offset: 2px;
    }
  `,
  region: css`
    pointer-events: none;

    position: absolute;

    border: 2px dashed ${MARKER_COLOR};
    border-radius: 2px;

    background: color-mix(in srgb, ${MARKER_COLOR} 8%, transparent);

    &[data-active='true'] {
      border-color: ${cssVar.colorWarning};
    }
  `,
}));

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
            className={markerStyles.region}
            data-active={active}
            data-testid={'image-comment-region'}
            style={{
              height: `${comment.anchor.rect.height * 100}%`,
              left: `${comment.anchor.rect.x * 100}%`,
              top: `${comment.anchor.rect.y * 100}%`,
              width: `${comment.anchor.rect.width * 100}%`,
            }}
          />
        )}
        <button
          aria-label={t('imageViewer.comment.pin', { index: index + 1 })}
          className={markerStyles.pin}
          data-active={active}
          tabIndex={onSelect ? undefined : -1}
          title={comment.text}
          type={'button'}
          style={{
            left: `${origin.x * 100}%`,
            pointerEvents: onSelect ? undefined : 'none',
            top: `${origin.y * 100}%`,
            ...upright,
          }}
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
