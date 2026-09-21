import type { AcceptanceReviewAnnotation } from '@lobechat/types';
import type { ReactNode } from 'react';

/**
 * A region drawn over an evidence image by someone other than the renderer:
 * a model proposal, or a reviewer's circled comment.
 *
 * `color` and `authorName` are what make several people's marks on one
 * screenshot tellable apart; `comment` is what the marker reveals when clicked.
 */
export interface EvidenceOverlay {
  /**
   * The author's face for the pin. A mark on a screenshot is somebody's
   * remark, and a row of identical speech bubbles says only "there are
   * remarks" — the face says who is waiting for an answer, the way Figma's
   * comment pins do.
   */
  authorAvatar?: string | null;
  /** Rendered next to the note when the marker is opened. */
  authorName?: string;
  /** Author colour — border, badge and marker share it. Falls back to the error red. */
  color?: string;
  comment?: string;
  /**
   * Overrides the badge number. Regions belonging to one review may be spread
   * across several images, and per-image numbering would restart at 1 on each.
   */
  label?: number;
  /**
   * What the floating note shows when the marker is opened. A caller that owns
   * a whole discussion thread passes it here; without one the note falls back
   * to `authorName` plus `comment`.
   */
  panel?: ReactNode;
  rect: AcceptanceReviewAnnotation['rect'];
  /** A handled thread reads as settled rather than an open concern. */
  resolved?: boolean;
}

export type EvidenceOverlayMap = Map<string, EvidenceOverlay[]>;
